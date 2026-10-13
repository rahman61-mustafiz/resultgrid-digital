-- Closes the remaining gap from round 2's external review: every
-- export-relevant edit (questionnaire answer, evidence item, project
-- fields, client/business fields) was still two separate statements from
-- the app's point of view -- a direct table write, then a second,
-- separate RPC call to invalidate the approval if needed
-- (reevaluateReadinessAfterEdit / invalidateApprovalForNonScoredEdit /
-- invalidateClientApprovals in src/lib/domain/readiness-ledger.ts). If the
-- second call failed, was skipped, or the process died between the two,
-- the underlying data could change while readiness_status still read
-- APPROVED -- exactly the inconsistency the ledger exists to prevent.
--
-- The fix is the same shape as 20260922120000's approve_and_export_project
-- (mutation + ledger bookkeeping inside one transaction): each edit now
-- has its own SECURITY DEFINER function that performs the write AND the
-- conditional invalidation together, so they can never apply separately.
-- Direct INSERT/UPDATE/DELETE on project_answers, evidence_items, and the
-- export-relevant columns of projects/client_businesses are revoked for
-- anon/authenticated -- these functions are the only path, matching the
-- readiness_status/project_approval_events lockdown from the earlier
-- migrations.
--
-- Also revokes EXECUTE on all ten ledger functions (the five from
-- 20260922120000 and the five new ones here) from service_role --
-- flagged as a minor discrepancy in review: their internal
-- is_workspace_owner() check already stops a service-role call (it has no
-- auth.uid()), but "authenticated only" should be true at the grant
-- level too, not just enforced by internal logic.

-- ---------------------------------------------------------------------
-- 1. New atomic mutation+invalidation functions.
-- ---------------------------------------------------------------------

create or replace function public.upsert_project_answer(
  p_project_id uuid,
  p_question_key text,
  p_questionnaire_version int,
  p_status text,
  p_value jsonb,
  p_next_readiness_status text
)
returns public.project_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_answer public.project_answers;
begin
  if p_next_readiness_status not in ('INCOMPLETE', 'READY_FOR_REVIEW') then
    raise exception 'invalid next_readiness_status %', p_next_readiness_status;
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

  insert into public.project_answers (
    workspace_id, project_id, question_key, questionnaire_version, status, value, updated_by
  ) values (
    v_workspace_id, p_project_id, p_question_key, p_questionnaire_version, p_status, p_value, auth.uid()
  )
  on conflict (project_id, question_key) do update
    set status = excluded.status,
        value = excluded.value,
        questionnaire_version = excluded.questionnaire_version,
        updated_by = excluded.updated_by
  returning * into v_answer;

  -- p_next_readiness_status is computed by the caller from the CURRENT
  -- answers plus this pending one (required-question definitions live in
  -- src/lib/questionnaire/v1.ts, not SQL -- see readiness.ts). Applying it
  -- here, in the same transaction as the write above, is what makes this
  -- atomic instead of "write, then hope the next RPC call happens too."
  if v_from_status <> 'INCOMPLETE' and v_from_status <> p_next_readiness_status then
    update public.projects
      set readiness_status = p_next_readiness_status
      where id = p_project_id;

    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', v_from_status, p_next_readiness_status,
      'Questionnaire answer changed after approval/review.', auth.uid()
    );
  end if;

  return v_answer;
end;
$$;

create or replace function public.add_evidence_item(
  p_project_id uuid,
  p_category text,
  p_original_filename text,
  p_external_url text,
  p_verification_status text,
  p_evidence_date date,
  p_notes text
)
returns public.evidence_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_item public.evidence_items;
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

  insert into public.evidence_items (
    workspace_id, project_id, category, original_filename, external_url,
    verification_status, evidence_date, notes, created_by
  ) values (
    v_workspace_id, p_project_id, p_category, p_original_filename, p_external_url,
    p_verification_status, p_evidence_date, p_notes, auth.uid()
  )
  returning * into v_item;

  -- Evidence has no effect on readiness *scoring* (see
  -- src/lib/questionnaire/readiness.ts), so the only transition it can
  -- ever cause is dropping an APPROVED project back to READY_FOR_REVIEW.
  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Evidence item added after approval.', auth.uid()
    );
  end if;

  return v_item;
end;
$$;

create or replace function public.delete_evidence_item(
  p_item_id uuid,
  p_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
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

  delete from public.evidence_items
  where id = p_item_id and project_id = p_project_id;

  if not found then
    raise exception 'evidence item % not found on project %', p_item_id, p_project_id;
  end if;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Evidence item removed after approval.', auth.uid()
    );
  end if;
end;
$$;

create or replace function public.update_project_details(
  p_project_id uuid,
  p_client_business_id uuid,
  p_project_name text,
  p_project_type text,
  p_custom_type_label text,
  p_lifecycle_status text,
  p_default_currency text,
  p_export_language text,
  p_timezone text,
  p_start_date date,
  p_target_completion_date date,
  p_short_description text,
  p_internal_notes text,
  p_tags text[]
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_project public.projects;
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

  update public.projects
    set client_business_id = p_client_business_id,
        project_name = p_project_name,
        project_type = p_project_type,
        custom_type_label = p_custom_type_label,
        lifecycle_status = p_lifecycle_status,
        default_currency = p_default_currency,
        export_language = p_export_language,
        timezone = p_timezone,
        start_date = p_start_date,
        target_completion_date = p_target_completion_date,
        short_description = p_short_description,
        internal_notes = p_internal_notes,
        tags = p_tags
    where id = p_project_id
    returning * into v_project;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    v_project.readiness_status := 'READY_FOR_REVIEW';
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Project details changed after approval.', auth.uid()
    );
  end if;

  return v_project;
end;
$$;

create or replace function public.update_client_business_details(
  p_client_business_id uuid,
  p_display_name text,
  p_record_type text,
  p_country text,
  p_timezone text,
  p_legal_name text,
  p_website text,
  p_industry text,
  p_primary_contact_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_internal_notes text
)
returns public.client_businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_client public.client_businesses;
  r record;
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

  update public.client_businesses
    set display_name = p_display_name,
        record_type = p_record_type,
        country = p_country,
        timezone = p_timezone,
        legal_name = p_legal_name,
        website = p_website,
        industry = p_industry,
        primary_contact_name = p_primary_contact_name,
        email = p_email,
        phone = p_phone,
        address = p_address,
        internal_notes = p_internal_notes
    where id = p_client_business_id
    returning * into v_client;

  -- Bulk: every APPROVED project under this client invalidates together,
  -- in the same transaction as the client edit that caused it.
  for r in
    select id from public.projects
    where client_business_id = p_client_business_id
      and readiness_status = 'APPROVED'
    for update
  loop
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = r.id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, r.id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Client/business details changed after approval.', auth.uid()
    );
  end loop;

  return v_client;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Grants: authenticated only, on all ten ledger-touching functions.
-- ---------------------------------------------------------------------

revoke execute on function public.upsert_project_answer(uuid, text, int, text, jsonb, text) from public, anon, service_role;
revoke execute on function public.add_evidence_item(uuid, text, text, text, text, date, text) from public, anon, service_role;
revoke execute on function public.delete_evidence_item(uuid, uuid) from public, anon, service_role;
revoke execute on function public.update_project_details(uuid, uuid, text, text, text, text, text, text, text, date, date, text, text, text[]) from public, anon, service_role;
revoke execute on function public.update_client_business_details(uuid, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, service_role;

grant execute on function public.upsert_project_answer(uuid, text, int, text, jsonb, text) to authenticated;
grant execute on function public.add_evidence_item(uuid, text, text, text, text, date, text) to authenticated;
grant execute on function public.delete_evidence_item(uuid, uuid) to authenticated;
grant execute on function public.update_project_details(uuid, uuid, text, text, text, text, text, text, text, date, date, text, text, text[]) to authenticated;
grant execute on function public.update_client_business_details(uuid, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- The five functions from 20260922120000_approval_ledger_hardening.sql
-- kept an implicit service_role EXECUTE grant (Postgres grants EXECUTE to
-- the function owner's other roles/PUBLIC by default; the prior
-- migration's "revoke from public, anon" didn't separately touch
-- service_role). Their internal checks already deny a service-role caller
-- (no auth.uid()), but make "authenticated is the only API role" true at
-- the grant level too.
revoke execute on function public.submit_project_for_review(uuid) from service_role;
revoke execute on function public.approve_and_export_project(uuid, text, text, text, int, text) from service_role;
revoke execute on function public.record_project_export(uuid, text, text, text, int) from service_role;
revoke execute on function public.invalidate_project_approval(uuid, text, text) from service_role;
revoke execute on function public.invalidate_client_approvals(uuid, text) from service_role;

-- ---------------------------------------------------------------------
-- 3. Lock down the direct table writes these functions replace.
-- ---------------------------------------------------------------------

revoke insert, update, delete on public.project_answers from anon, authenticated;
revoke insert, update, delete on public.evidence_items from anon, authenticated;

-- projects: no more direct UPDATE at all for authenticated -- both
-- readiness_status (already revoked in 20260922130000) and every other
-- column (now only reachable via update_project_details) go through an
-- RPC. Table-level revoke alone does not clear a previously granted
-- column-level ACL entry (the exact bug fixed in
-- 20260922130000_approval_ledger_grants_fix.sql), so the specific column
-- list from that migration is revoked explicitly here too.
revoke update on public.projects from anon, authenticated;
revoke update (
  client_business_id, project_name, project_type, custom_type_label,
  lifecycle_status, default_currency, export_language, timezone,
  start_date, target_completion_date, short_description, internal_notes,
  tags
) on public.projects from authenticated;

-- client_businesses: same table-level-grant-covers-everything problem as
-- projects originally had, so this is a full revoke + narrow re-grant
-- rather than a column-level revoke. status/archived_at stay directly
-- writable -- archiveClientBusinessAction/restoreClientBusinessAction set
-- them together outside any RPC, and neither affects export content or
-- needs invalidation.
revoke update on public.client_businesses from anon, authenticated;
grant update (status, archived_at) on public.client_businesses to authenticated;
