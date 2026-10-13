-- Priority #12: findings from `supabase db advisors`.
--
-- 1. auth_rls_initplan: two policies called auth.uid() once per row.
--    Wrapping it in a scalar subquery lets Postgres evaluate it once per
--    statement. Same rules, same result.
-- 2. The project lock helpers took row locks (FOR SHARE / FOR UPDATE) and
--    answered "project not found" before checking who was asking, so any
--    signed-in account could hold locks on, and probe the existence of,
--    projects it can't see. They now check authorization first: a caller
--    who isn't the project's Owner at aal2 gets "not authorized" whether or
--    not the project exists, and takes no lock. The check is repeated after
--    locking, as before.

drop policy if exists workspace_members_select_self on public.workspace_members;
create policy workspace_members_select_self
  on public.workspace_members
  for select
  to authenticated
  using (private.has_aal2() and user_id = (select auth.uid()));

drop policy if exists security_events_select_owner on public.security_events;
create policy security_events_select_owner
  on public.security_events
  for select
  to authenticated
  using (
    private.has_aal2()
    and (
      (workspace_id is not null and private.workspace_role(workspace_id) = 'OWNER')
      or (
        workspace_id is null
        and exists (
          select 1
          from public.workspace_members m
          where m.user_id = (select auth.uid())
            and m.role = 'OWNER'
        )
      )
    )
  );

-- Raises 'not authorized' unless the caller is the Owner (aal2) of the
-- project's workspace; 'project not found' only for an Owner. Takes no lock.
create or replace function private.authorize_project_owner(p_project_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select p.workspace_id into v_workspace_id from public.projects p where p.id = p_project_id;
  if v_workspace_id is null then
    if not exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and private.is_workspace_owner(m.workspace_id)
    ) then
      raise exception 'not authorized';
    end if;
    raise exception 'project % not found', p_project_id;
  end if;
  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;
end;
$$;

revoke all on function private.authorize_project_owner(uuid) from public, anon, authenticated;

create or replace function private.lock_project_for_lifecycle(p_project_id uuid, p_lock_share_links boolean default false)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_project public.projects;
begin
  perform private.authorize_project_owner(p_project_id);

  select client_business_id into v_client_id from public.projects where id = p_project_id;
  if v_client_id is null then
    raise exception 'project % not found', p_project_id;
  end if;
  perform 1 from public.client_businesses where id = v_client_id for share;
  if p_lock_share_links then
    perform 1 from public.client_share_links where project_id = p_project_id order by id for update;
  end if;
  select * into v_project from public.projects where id = p_project_id for update;
  if not private.is_workspace_owner(v_project.workspace_id) then
    raise exception 'not authorized';
  end if;
  return v_project;
end;
$$;

create or replace function private.lock_and_verify_export_inputs(p_project_id uuid, p_expected_fingerprint text, out workspace_id uuid, out readiness_status text)
returns record
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_locked_client_id uuid;
begin
  perform private.authorize_project_owner(p_project_id);

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
