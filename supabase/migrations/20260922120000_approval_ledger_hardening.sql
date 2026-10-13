-- Hardens the approval/version/invalidation ledger introduced in
-- 20260922110000_project_approval_events.sql. That first pass got the
-- schema and immutability right but left every transition as two separate
-- app-issued statements (an UPDATE on projects, then an INSERT into
-- project_approval_events) with actor/timestamp supplied by the app layer
-- -- not atomic, and not actually enforced to be the only path. This
-- migration closes both gaps:
--
--   1. All status transitions + their ledger entries happen inside one
--      SECURITY DEFINER function per transition type, so they can never
--      partially apply.
--   2. Direct authenticated writes to projects.readiness_status and to
--      project_approval_events are revoked -- these functions are the
--      only path, and they set actor_id/created_at themselves
--      (auth.uid()/now()), never from a client-supplied argument.
--   3. APPROVED is only ever reached together with inserting the
--      project_exports row it approves, in the same transaction, with the
--      ledger's export_version pointing at it -- an approval is never a
--      bare status disconnected from an immutable snapshot.

-- ---------------------------------------------------------------------
-- 1. Lock down direct writes.
-- ---------------------------------------------------------------------

-- No INSERT policy at all for project_approval_events now -- every row
-- must come from one of the functions below (SECURITY DEFINER, so it
-- bypasses RLS the same way private.* helper functions already do).
drop policy if exists project_approval_events_insert on public.project_approval_events;

-- readiness_status may only change through submit_project_for_review /
-- approve_and_export_project / invalidate_project_approval /
-- invalidate_client_approvals below -- never via a plain
-- `.from("projects").update(...)` call, even one otherwise permitted by
-- the projects_update RLS policy for the project's own fields.
revoke update (readiness_status) on public.projects from authenticated;

-- ---------------------------------------------------------------------
-- 2. Transition functions.
-- ---------------------------------------------------------------------

create or replace function public.submit_project_for_review(p_project_id uuid)
returns public.project_approval_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_event public.project_approval_events;
begin
  select workspace_id, readiness_status into v_workspace_id, v_from_status
  from public.projects
  where id = p_project_id
  for update;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  if v_from_status <> 'INCOMPLETE' then
    raise exception 'project must be INCOMPLETE to submit for review (current: %)', v_from_status;
  end if;

  update public.projects
    set readiness_status = 'READY_FOR_REVIEW'
    where id = p_project_id;

  insert into public.project_approval_events (
    workspace_id, project_id, event_type, from_status, to_status, actor_id
  ) values (
    v_workspace_id, p_project_id, 'SUBMITTED_FOR_REVIEW', v_from_status, 'READY_FOR_REVIEW', auth.uid()
  )
  returning * into v_event;

  return v_event;
end;
$$;

grant execute on function public.submit_project_for_review(uuid) to authenticated;

-- Approval and the export snapshot it approves are created together. This
-- app has exactly one actor (the single Owner account), so the
-- p_expected_version compare-and-swap below exists to fail loudly on a
-- coding mistake, not to defend against real concurrent callers -- if it
-- ever fires, the caller re-reads state and retries rather than silently
-- inserting a mismatched version number into the content it already
-- rendered.
create or replace function public.approve_and_export_project(
  p_project_id uuid,
  p_content text,
  p_evidence_index_content text,
  p_export_manifest_content text,
  p_expected_version int,
  p_approval_note text default null
)
returns table (export_version int, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_next_version int;
  v_event_id uuid;
begin
  select workspace_id, readiness_status into v_workspace_id, v_from_status
  from public.projects
  where id = p_project_id
  for update;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  if v_from_status <> 'READY_FOR_REVIEW' then
    raise exception 'project must be READY_FOR_REVIEW to approve (current: %)', v_from_status;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.project_exports
  where project_id = p_project_id;

  if v_next_version <> p_expected_version then
    raise exception 'export version conflict: expected % but computed % -- retry', p_expected_version, v_next_version;
  end if;

  insert into public.project_exports (
    workspace_id, project_id, version, content, evidence_index_content,
    export_manifest_content, generated_by
  ) values (
    v_workspace_id, p_project_id, v_next_version, p_content, p_evidence_index_content,
    p_export_manifest_content, auth.uid()
  );

  update public.projects
    set readiness_status = 'APPROVED'
    where id = p_project_id;

  insert into public.project_approval_events (
    workspace_id, project_id, event_type, from_status, to_status,
    export_version, reason, actor_id
  ) values (
    v_workspace_id, p_project_id, 'APPROVED', 'READY_FOR_REVIEW', 'APPROVED',
    v_next_version, p_approval_note, auth.uid()
  )
  returning id into v_event_id;

  return query select v_next_version, v_event_id;
end;
$$;

grant execute on function public.approve_and_export_project(uuid, text, text, text, int, text) to authenticated;

-- Re-exports an already-APPROVED project (a fresh timestamped copy of the
-- same approved content, e.g. to re-send to a client) without touching
-- readiness_status. Since any export-relevant edit invalidates APPROVED
-- back to READY_FOR_REVIEW (see invalidate_project_approval /
-- invalidate_client_approvals), staying APPROVED here guarantees nothing
-- changed since the original approval -- this can never produce content
-- that disagrees with what was approved.
create or replace function public.record_project_export(
  p_project_id uuid,
  p_content text,
  p_evidence_index_content text,
  p_export_manifest_content text,
  p_expected_version int
)
returns table (export_version int, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_status text;
  v_next_version int;
  v_event_id uuid;
begin
  select workspace_id, readiness_status into v_workspace_id, v_status
  from public.projects
  where id = p_project_id
  for update;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  if v_status <> 'APPROVED' then
    raise exception 'project must be APPROVED to export (current: %)', v_status;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.project_exports
  where project_id = p_project_id;

  if v_next_version <> p_expected_version then
    raise exception 'export version conflict: expected % but computed % -- retry', p_expected_version, v_next_version;
  end if;

  insert into public.project_exports (
    workspace_id, project_id, version, content, evidence_index_content,
    export_manifest_content, generated_by
  ) values (
    v_workspace_id, p_project_id, v_next_version, p_content, p_evidence_index_content,
    p_export_manifest_content, auth.uid()
  );

  insert into public.project_approval_events (
    workspace_id, project_id, event_type, from_status, to_status,
    export_version, actor_id
  ) values (
    v_workspace_id, p_project_id, 'EXPORTED', 'APPROVED', 'APPROVED',
    v_next_version, auth.uid()
  )
  returning id into v_event_id;

  return query select v_next_version, v_event_id;
end;
$$;

grant execute on function public.record_project_export(uuid, text, text, text, int) to authenticated;

-- Single-project invalidation, used both when a questionnaire answer edit
-- changes readiness *scoring* (p_next_status computed by the app from
-- computeReadiness, which the DB can't derive itself -- the required-
-- question definitions live in src/lib/questionnaire/v1.ts, not in SQL)
-- and when a non-scored export-relevant edit (evidence, project fields)
-- must drop an APPROVED project back to READY_FOR_REVIEW regardless of
-- scoring (callers pass p_next_status = 'READY_FOR_REVIEW' for that case;
-- this function's own no-op check -- current status already equal to
-- p_next_status -- makes that safe to call unconditionally).
create or replace function public.invalidate_project_approval(
  p_project_id uuid,
  p_next_status text,
  p_reason text
)
returns public.project_approval_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_event public.project_approval_events;
begin
  if p_next_status not in ('INCOMPLETE', 'READY_FOR_REVIEW') then
    raise exception 'invalid next_status %', p_next_status;
  end if;

  select workspace_id, readiness_status into v_workspace_id, v_from_status
  from public.projects
  where id = p_project_id
  for update;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  if v_from_status = 'INCOMPLETE' or v_from_status = p_next_status then
    return null;
  end if;

  update public.projects
    set readiness_status = p_next_status
    where id = p_project_id;

  insert into public.project_approval_events (
    workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_workspace_id, p_project_id, 'INVALIDATED', v_from_status, p_next_status, p_reason, auth.uid()
  )
  returning * into v_event;

  return v_event;
end;
$$;

grant execute on function public.invalidate_project_approval(uuid, text, text) to authenticated;

-- Bulk variant for editing a client_businesses row, which can be shared
-- by several projects -- every APPROVED project under it must invalidate
-- together, since client identity fields are embedded in all of their
-- exports (see generateProjectContextMarkdown).
create or replace function public.invalidate_client_approvals(
  p_client_business_id uuid,
  p_reason text
)
returns setof public.project_approval_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  r record;
  v_event public.project_approval_events;
begin
  select workspace_id into v_workspace_id
  from public.client_businesses
  where id = p_client_business_id
  for update;

  if v_workspace_id is null then
    raise exception 'client_business % not found', p_client_business_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  for r in
    select id from public.projects
    where client_business_id = p_client_business_id
      and readiness_status = 'APPROVED'
    for update
  loop
    update public.projects
      set readiness_status = 'READY_FOR_REVIEW'
      where id = r.id;

    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, r.id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW', p_reason, auth.uid()
    )
    returning * into v_event;

    return next v_event;
  end loop;

  return;
end;
$$;

grant execute on function public.invalidate_client_approvals(uuid, text) to authenticated;
