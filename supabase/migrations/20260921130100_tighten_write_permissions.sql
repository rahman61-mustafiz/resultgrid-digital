-- Tighten client_businesses/projects RLS so writes require the OWNER role
-- specifically, not just "any workspace member." Today the two are
-- equivalent (only OWNER rows exist in workspace_members), but
-- BUILD_READINESS_QUESTIONNAIRE.md C05-C11 says Editor/Viewer/Client
-- Read-only "require a fresh, separate confirmation before being enabled"
-- -- that should be enforced by policy now, not left to happen
-- automatically the day a non-Owner membership row is first inserted.

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_aal2()
    and private.workspace_role(target_workspace_id) = 'OWNER';
$$;

grant execute on function private.is_workspace_owner(uuid) to authenticated;

drop policy if exists client_businesses_insert on public.client_businesses;
drop policy if exists client_businesses_update on public.client_businesses;

create policy client_businesses_insert
  on public.client_businesses
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy client_businesses_update
  on public.client_businesses
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;

create policy projects_insert
  on public.projects
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy projects_update
  on public.projects
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

-- A project's client_business_id must reference a client in the SAME
-- workspace as the project. The foreign key alone can't express that (it
-- only guarantees the client row exists somewhere); a caller with valid
-- access to workspace A could otherwise point a project at workspace B's
-- client. Not exploitable today (there is only one workspace in the whole
-- system), but wrong to leave unenforced now that multi-workspace is part
-- of the confirmed data model.
create or replace function private.check_project_client_same_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  client_workspace_id uuid;
begin
  select workspace_id into client_workspace_id
  from public.client_businesses
  where id = new.client_business_id;

  if client_workspace_id is null or client_workspace_id <> new.workspace_id then
    raise exception 'project workspace_id (%) does not match client_business workspace_id (%)',
      new.workspace_id, client_workspace_id;
  end if;

  return new;
end;
$$;

create trigger projects_check_client_same_workspace
  before insert or update on public.projects
  for each row
  execute function private.check_project_client_same_workspace();
