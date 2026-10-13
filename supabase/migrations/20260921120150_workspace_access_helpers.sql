-- Workspace-membership RLS helper functions. Split into their own
-- migration, after 20260921120100_workspaces.sql, because these are
-- LANGUAGE SQL functions and PostgreSQL validates their body against the
-- catalog at CREATE time -- public.workspace_members must already exist.

-- The caller's role in the given workspace, or null if not a member.
create or replace function private.workspace_role(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = target_workspace_id
    and m.user_id = auth.uid()
  limit 1;
$$;

-- True when the caller is a member of the given workspace (any role) and
-- has an AAL2 session. Every workspace-scoped table's RLS policies should
-- be built on this function so workspace isolation and the AAL2 rule are
-- enforced consistently and in one place.
create or replace function private.can_access_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_aal2()
    and exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = target_workspace_id
        and m.user_id = auth.uid()
    );
$$;

grant execute on function private.workspace_role(uuid) to authenticated;
grant execute on function private.can_access_workspace(uuid) to authenticated;

-- A member can see workspaces they belong to (AAL2 required).
create policy workspaces_select_member
  on public.workspaces
  for select
  to authenticated
  using (private.can_access_workspace(id));
