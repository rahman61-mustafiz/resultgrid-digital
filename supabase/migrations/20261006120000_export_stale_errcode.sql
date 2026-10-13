-- The stale-export checks (20261006100000) raised SQLSTATE 40001
-- (serialization_failure). PostgREST treats 40001 as retryable and kept
-- re-running the rejected call until the upstream request timed out, so the
-- caller never received the rejection and the database kept doing work.
-- PT409 is PostgREST's convention for an HTTP 409 Conflict response:
-- returned to the caller immediately, never retried. Body otherwise
-- unchanged.

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
      using errcode = 'PT409';
  end if;

  if not private.is_workspace_owner(workspace_id) then
    raise exception 'not authorized';
  end if;

  if p_expected_fingerprint is null
     or md5(private.project_export_inputs(p_project_id)::text) <> p_expected_fingerprint then
    raise exception 'export content is stale: the project changed after this export was generated -- regenerate and retry'
      using errcode = 'PT409';
  end if;
end;
$$;

