-- get_project_export_snapshot (20261006100000) was SECURITY INVOKER and
-- called private.project_export_inputs, but `authenticated` has no USAGE on
-- schema private, so the app's call failed with "permission denied for
-- schema private". Make it SECURITY DEFINER with the same explicit check
-- every other ledger RPC uses (private.is_workspace_owner: aal2 + OWNER),
-- and take back the now-unneeded grant on the private helper.
--
-- The data still comes from ONE statement (inputs, fingerprint and next
-- version are computed together), so the snapshot stays consistent.

create or replace function public.get_project_export_snapshot(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_snapshot jsonb;
begin
  select p.workspace_id into v_workspace_id
  from public.projects p
  where p.id = p_project_id;

  if v_workspace_id is null then
    return null;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select s.inputs || jsonb_build_object(
    'fingerprint', md5(s.inputs::text),
    'next_version', (
      select coalesce(max(x.version), 0) + 1
      from public.project_exports x
      where x.project_id = p_project_id
    )
  )
  into v_snapshot
  from (select private.project_export_inputs(p_project_id) as inputs) s;

  return v_snapshot;
end;
$$;

revoke execute on function public.get_project_export_snapshot(uuid) from public, anon, service_role;
grant execute on function public.get_project_export_snapshot(uuid) to authenticated;

revoke execute on function private.project_export_inputs(uuid) from authenticated;
