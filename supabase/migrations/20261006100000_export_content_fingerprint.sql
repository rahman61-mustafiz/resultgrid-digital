-- Export content must match the state that gets approved.
--
-- The app renders export Markdown from data it read earlier, then calls
-- approve_and_export_project / record_project_export. Until now:
--   * the app read project, client, answers, evidence and the last export
--     version in separate requests (separate snapshots), so one export could
--     mix data from before and after an edit;
--   * the only check at write time was p_expected_version, which catches a
--     concurrent export but not an edit to answers/evidence/project/client
--     made after the read -- the edit doesn't create an export, so the
--     version still matched and a stale export could be approved;
--   * update_client_business_details locks the client row and only APPROVED
--     project rows, so a client edit could commit while an approval of a
--     READY_FOR_REVIEW project was in flight.
--
-- Now:
--   * private.project_export_inputs() is the exact set of fields the
--     generator uses; its md5 is the content fingerprint.
--   * get_project_export_snapshot() returns those inputs, the fingerprint
--     and the next version from ONE statement.
--   * Both export-writing RPCs require p_expected_fingerprint and recompute
--     it after locking the client row (FOR SHARE) and the project row (FOR
--     UPDATE). Every writer of export inputs takes one of those locks first
--     (answers/evidence/project fields: project row FOR UPDATE; client
--     fields: client row FOR UPDATE), so nothing can change the inputs
--     between the recompute and the commit. Lock order is client -> project,
--     the same order client edits use, so the two can't deadlock.
--   * A mismatch raises SQLSTATE 40001 ("regenerate and retry").

create or replace function private.project_export_inputs(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id,
      'project_name', p.project_name,
      'project_type', p.project_type,
      'custom_type_label', p.custom_type_label,
      'default_currency', p.default_currency,
      'export_language', p.export_language
    ),
    'client', jsonb_build_object(
      'display_name', cb.display_name,
      'record_type', cb.record_type,
      'country', cb.country
    ),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_key', a.question_key,
        'status', a.status,
        'value', a.value
      ) order by a.question_key)
      from public.project_answers a
      where a.project_id = p.id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', e.category,
        'original_filename', e.original_filename,
        'external_url', e.external_url,
        'verification_status', e.verification_status,
        'evidence_date', e.evidence_date
      ) order by e.created_at, e.id)
      from public.evidence_items e
      where e.project_id = p.id
    ), '[]'::jsonb)
  )
  from public.projects p
  join public.client_businesses cb on cb.id = p.client_business_id
  where p.id = p_project_id
$$;

revoke execute on function private.project_export_inputs(uuid) from public, anon;
grant execute on function private.project_export_inputs(uuid) to authenticated;

create or replace function public.get_project_export_snapshot(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select s.inputs || jsonb_build_object(
    'fingerprint', md5(s.inputs::text),
    'next_version', (
      select coalesce(max(x.version), 0) + 1
      from public.project_exports x
      where x.project_id = p_project_id
    )
  )
  from (select private.project_export_inputs(p_project_id) as inputs) s
  where s.inputs is not null
$$;

revoke execute on function public.get_project_export_snapshot(uuid) from public, anon, service_role;
grant execute on function public.get_project_export_snapshot(uuid) to authenticated;

-- Locks the client row (FOR SHARE) then the project row (FOR UPDATE), then
-- checks the fingerprint. Returns the project's workspace_id and status.
create or replace function private.lock_and_verify_export_inputs(
  p_project_id uuid,
  p_expected_fingerprint text,
  out workspace_id uuid,
  out readiness_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_locked_client_id uuid;
begin
  select p.client_business_id into v_client_id
  from public.projects p
  where p.id = p_project_id;

  if v_client_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  perform 1 from public.client_businesses cb where cb.id = v_client_id for share;

  select p.workspace_id, p.readiness_status, p.client_business_id
    into workspace_id, readiness_status, v_locked_client_id
  from public.projects p
  where p.id = p_project_id
  for update;

  if v_locked_client_id is distinct from v_client_id then
    raise exception 'project moved to another client during export -- regenerate and retry'
      using errcode = '40001';
  end if;

  if not private.is_workspace_owner(workspace_id) then
    raise exception 'not authorized';
  end if;

  if p_expected_fingerprint is null
     or md5(private.project_export_inputs(p_project_id)::text) <> p_expected_fingerprint then
    raise exception 'export content is stale: the project changed after this export was generated -- regenerate and retry'
      using errcode = '40001';
  end if;
end;
$$;

revoke execute on function private.lock_and_verify_export_inputs(uuid, text) from public, anon, authenticated, service_role;

drop function public.approve_and_export_project(uuid, text, text, text, int, text);

create function public.approve_and_export_project(
  p_project_id uuid,
  p_content text,
  p_evidence_index_content text,
  p_export_manifest_content text,
  p_expected_version int,
  p_expected_fingerprint text,
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
  select l.workspace_id, l.readiness_status into v_workspace_id, v_from_status
  from private.lock_and_verify_export_inputs(p_project_id, p_expected_fingerprint) l;

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

revoke execute on function public.approve_and_export_project(uuid, text, text, text, int, text, text) from public, anon, service_role;
grant execute on function public.approve_and_export_project(uuid, text, text, text, int, text, text) to authenticated;

drop function public.record_project_export(uuid, text, text, text, int);

create function public.record_project_export(
  p_project_id uuid,
  p_content text,
  p_evidence_index_content text,
  p_export_manifest_content text,
  p_expected_version int,
  p_expected_fingerprint text
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
  select l.workspace_id, l.readiness_status into v_workspace_id, v_status
  from private.lock_and_verify_export_inputs(p_project_id, p_expected_fingerprint) l;

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

revoke execute on function public.record_project_export(uuid, text, text, text, int, text) from public, anon, service_role;
grant execute on function public.record_project_export(uuid, text, text, text, int, text) to authenticated;
