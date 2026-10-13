-- Follow-up to 20261008100000_lifecycle_archive_delete_rules.sql.
--
-- 1. Revoking share links on archive now also clears the session nonce,
--    exactly like revokeShareLinkAction, so a viewer who already entered
--    the PIN loses access immediately, not just new PIN attempts.
-- 2. A share link can't be brought back (un-revoked or extended, which is
--    what extendShareLinkAction does) while its project is archived or its
--    client is archived. PIN-attempt and session updates stay allowed.

create or replace function private.revoke_project_share_links(p_project_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.client_share_links
    set revoked_at = now(), session_nonce_hash = null, session_nonce_expires_at = null
    where project_id = any (p_project_ids) and revoked_at is null;
$$;

revoke execute on function private.revoke_project_share_links(uuid[]) from public, anon, authenticated, service_role;

-- Only reactivations run the check (WHEN clause); PIN-attempt and session
-- updates don't.
create trigger client_share_links_reactivation_accepts_work
  before update on public.client_share_links
  for each row
  when ((old.revoked_at is not null and new.revoked_at is null) or new.expires_at > old.expires_at)
  execute function private.assert_project_accepts_work();

-- Re-create the two archive paths to use the full revocation.
create or replace function public.set_project_lifecycle(
  p_project_id uuid,
  p_to_status text,
  p_reason text default null
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_from text;
  v_client_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_project := private.lock_project_for_lifecycle(p_project_id);
  v_from := v_project.lifecycle_status;

  if v_project.lifecycle_status = 'ARCHIVED' then
    raise exception 'this project is archived: use restore';
  end if;
  if p_to_status = v_project.lifecycle_status then
    raise exception 'the project is already %', p_to_status;
  end if;
  if not private.project_lifecycle_transition_allowed(v_project.lifecycle_status, p_to_status) then
    raise exception 'a project cannot move from % to %', v_project.lifecycle_status, p_to_status;
  end if;
  if v_project.lifecycle_status = 'COMPLETED' and p_to_status = 'ACTIVE' and v_reason is null then
    raise exception 'reopening a completed project requires a reason';
  end if;

  select status into v_client_status from public.client_businesses where id = v_project.client_business_id;
  if p_to_status <> 'ARCHIVED' and v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived: restore the client first';
  end if;

  update public.projects set lifecycle_status = p_to_status where id = p_project_id
    returning * into v_project;

  if p_to_status = 'ARCHIVED' then
    perform private.revoke_project_share_links(array[p_project_id]);
  end if;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    case when p_to_status = 'ARCHIVED' then 'ARCHIVED' else 'LIFECYCLE_CHANGED' end,
    v_from, p_to_status, v_reason, auth.uid()
  );

  return v_project;
end;
$$;

create or replace function public.archive_client_business(p_client_business_id uuid, p_reason text default null)
returns public.client_businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.client_businesses;
  v_open int;
begin
  select * into v_client from public.client_businesses where id = p_client_business_id for update;
  if v_client.id is null then
    raise exception 'client/business % not found', p_client_business_id;
  end if;
  if not private.is_workspace_owner(v_client.workspace_id) then
    raise exception 'not authorized';
  end if;
  if v_client.status = 'ARCHIVED' then
    raise exception 'this client/business is already archived';
  end if;

  perform 1 from public.projects where client_business_id = p_client_business_id for update;

  select count(*) into v_open from public.projects
  where client_business_id = p_client_business_id and lifecycle_status in ('ACTIVE', 'ON_HOLD');
  if v_open > 0 then
    raise exception 'this client/business has % active or on-hold project(s): complete or archive them first', v_open;
  end if;

  update public.client_businesses set status = 'ARCHIVED', archived_at = now()
    where id = p_client_business_id
    returning * into v_client;

  perform private.revoke_project_share_links(
    array(select id from public.projects where client_business_id = p_client_business_id)
  );

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'ARCHIVED', 'ACTIVE', 'ARCHIVED', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  return v_client;
end;
$$;
