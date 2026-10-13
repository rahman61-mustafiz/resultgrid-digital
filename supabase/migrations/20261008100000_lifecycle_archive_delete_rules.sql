-- Project/client transfer, lifecycle, archive and permanent-deletion rules
-- (BUILD_READINESS_QUESTIONNAIRE.md B05-B07, D "Recorded project types,
-- statuses, and approval rules", J "retention").
--
-- B05  A project belongs to exactly one client and cannot be transferred.
--      update_project_details no longer takes a client (or a lifecycle);
--      a wrong project is archived and recreated under the right client.
-- D    Lifecycle ACTIVE -> ON_HOLD -> COMPLETED -> ARCHIVED, changed only by
--      set_project_lifecycle / restore_project along the allowed edges:
--        ACTIVE    -> ON_HOLD, COMPLETED, ARCHIVED
--        ON_HOLD   -> ACTIVE, COMPLETED, ARCHIVED
--        COMPLETED -> ACTIVE (reopen; reason required), ARCHIVED
--        ARCHIVED  -> the status it had before archiving (restore_project)
--      A new project always starts ACTIVE + INCOMPLETE.
-- B06  Archive/restore for clients and projects. An archived client cannot
--      receive new work: no new projects, no restore/reopen of its projects,
--      and no edits to its projects. An archived project is read-only. A
--      client can only be archived once none of its projects is ACTIVE or
--      ON_HOLD. Archiving revokes the affected share links.
-- B07/J Permanent deletion: Owner only, password + TOTP within the last 5
--      minutes (checked here from the access token's amr claims, not just
--      in the app), the exact name typed as confirmation, and only after
--      30 days archived. Audit, approval, financial and export history is
--      never hard-deleted: a project with exports, approval events,
--      financial records, or approved/published creatives is retained, and
--      the refusal says why. A client can only be deleted once it has no
--      projects.
--
-- Every lifecycle change and deletion is recorded in the append-only
-- lifecycle_events table, which keeps the entity's id and name (no foreign
-- key) so the record outlives a permanent deletion.
--
-- Lock order everywhere: client before project (the same order the export
-- RPCs and update_client_business_details use), so none of these can
-- deadlock with each other.

-- ---------------------------------------------------------------------
-- 1. Append-only lifecycle history
-- ---------------------------------------------------------------------

create table public.lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null check (entity_type in ('PROJECT', 'CLIENT_BUSINESS')),
  entity_id uuid not null,
  entity_name text not null,
  event_type text not null check (
    event_type in ('LIFECYCLE_CHANGED', 'ARCHIVED', 'RESTORED', 'PERMANENTLY_DELETED')
  ),
  from_status text,
  to_status text,
  reason text,
  -- No foreign key: history must survive the actor's account being removed.
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index lifecycle_events_entity_idx on public.lifecycle_events (entity_id, created_at desc);

alter table public.lifecycle_events enable row level security;

create policy lifecycle_events_select
  on public.lifecycle_events
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

revoke insert, update, delete, truncate on public.lifecycle_events from public, anon, authenticated, service_role;

create trigger lifecycle_events_forbid_update
  before update on public.lifecycle_events
  for each row execute function private.forbid_mutation();
create trigger lifecycle_events_forbid_delete
  before delete on public.lifecycle_events
  for each row execute function private.forbid_mutation();
create trigger lifecycle_events_forbid_truncate
  before truncate on public.lifecycle_events
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------
-- 2. Shared checks
-- ---------------------------------------------------------------------

-- Password AND TOTP both used within the window, from the access token's
-- amr claims (the same source src/lib/auth/reauth.ts reads).
create or replace function private.has_recent_password_and_totp(p_window_seconds int default 300)
returns boolean
language sql
stable
set search_path = ''
as $$
  with amr as (
    select e->>'method' as method, (e->>'timestamp')::bigint as ts
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
  )
  select coalesce((select max(ts) from amr where method = 'password'), 0) >= extract(epoch from now()) - p_window_seconds
     and coalesce((select max(ts) from amr where method = 'totp'), 0) >= extract(epoch from now()) - p_window_seconds
$$;

revoke execute on function private.has_recent_password_and_totp(int) from public, anon, authenticated, service_role;

create or replace function private.project_lifecycle_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('ACTIVE', 'ON_HOLD'), ('ACTIVE', 'COMPLETED'), ('ACTIVE', 'ARCHIVED'),
    ('ON_HOLD', 'ACTIVE'), ('ON_HOLD', 'COMPLETED'), ('ON_HOLD', 'ARCHIVED'),
    ('COMPLETED', 'ACTIVE'), ('COMPLETED', 'ARCHIVED')
  )
$$;

revoke execute on function private.project_lifecycle_transition_allowed(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. New rows: projects start ACTIVE + INCOMPLETE under an ACTIVE client;
--    clients start ACTIVE.
-- ---------------------------------------------------------------------

create or replace function private.enforce_new_project()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_client_status text;
begin
  if new.lifecycle_status <> 'ACTIVE' or new.readiness_status <> 'INCOMPLETE' then
    raise exception 'a new project must start ACTIVE and INCOMPLETE';
  end if;
  select status into v_client_status
  from public.client_businesses
  where id = new.client_business_id
  for share;
  if v_client_status is distinct from 'ACTIVE' then
    raise exception 'this client/business is archived: restore it before adding projects';
  end if;
  return new;
end;
$$;

create trigger projects_enforce_new
  before insert on public.projects
  for each row execute function private.enforce_new_project();

create or replace function private.enforce_new_client_business()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'ACTIVE' or new.archived_at is not null then
    raise exception 'a new client/business must start ACTIVE';
  end if;
  return new;
end;
$$;

create trigger client_businesses_enforce_new
  before insert on public.client_businesses
  for each row execute function private.enforce_new_client_business();

-- Client status/archived_at were directly writable by the Owner
-- (20260922150000); they now change only through the RPCs below.
revoke update (status, archived_at) on public.client_businesses from authenticated;

-- ---------------------------------------------------------------------
-- 4. Archived projects, and projects of archived clients, are read-only.
-- ---------------------------------------------------------------------

create or replace function private.assert_project_accepts_work()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  v_lifecycle text;
  v_client_id uuid;
  v_client_status text;
begin
  -- FOR SHARE serializes with archive/restore, which lock the project row
  -- FOR UPDATE.
  select lifecycle_status, client_business_id into v_lifecycle, v_client_id
  from public.projects
  where id = v_project_id
  for share;

  -- Parent already gone: this is a cascade from a permitted project delete.
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_lifecycle = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;

  select status into v_client_status from public.client_businesses where id = v_client_id;
  if v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived and read-only: restore the client first';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger project_answers_accepts_work
  before insert or update or delete on public.project_answers
  for each row execute function private.assert_project_accepts_work();
create trigger evidence_items_accepts_work
  before insert or update or delete on public.evidence_items
  for each row execute function private.assert_project_accepts_work();
create trigger financial_records_accepts_work
  before insert or update or delete on public.financial_records
  for each row execute function private.assert_project_accepts_work();
create trigger project_targets_accepts_work
  before insert or update or delete on public.project_targets
  for each row execute function private.assert_project_accepts_work();
create trigger creatives_accepts_work
  before insert or update or delete on public.creatives
  for each row execute function private.assert_project_accepts_work();
create trigger project_exports_accepts_work
  before insert on public.project_exports
  for each row execute function private.assert_project_accepts_work();
-- Share links: new links only. Existing rows keep receiving PIN-attempt and
-- session updates (and are revoked when their project/client is archived).
create trigger client_share_links_accepts_work
  before insert on public.client_share_links
  for each row execute function private.assert_project_accepts_work();

-- Table-level backstops on the parent rows themselves, so no write path
-- (RPC, service role, a future function) can get around the rules above.
create or replace function private.enforce_project_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_client_status text;
begin
  if new.client_business_id is distinct from old.client_business_id then
    raise exception 'a project cannot be moved to another client/business: archive it and create it again under the right one';
  end if;
  if old.lifecycle_status = 'ARCHIVED' and new.lifecycle_status = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;
  if new.lifecycle_status <> 'ARCHIVED' then
    select status into v_client_status from public.client_businesses where id = new.client_business_id;
    if v_client_status <> 'ACTIVE' then
      raise exception 'this project''s client/business is archived and read-only: restore the client first';
    end if;
  end if;
  return new;
end;
$$;

create trigger projects_enforce_update
  before update on public.projects
  for each row execute function private.enforce_project_update();

create or replace function private.enforce_client_business_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'ARCHIVED' and new.status = 'ARCHIVED' then
    raise exception 'this client/business is archived and read-only: restore it first';
  end if;
  return new;
end;
$$;

create trigger client_businesses_enforce_update
  before update on public.client_businesses
  for each row execute function private.enforce_client_business_update();

-- ---------------------------------------------------------------------
-- 5. update_project_details without client or lifecycle
-- ---------------------------------------------------------------------

drop function public.update_project_details(
  uuid, uuid, text, text, text, text, text, text, text, date, date, text, text, text[]
);

create function public.update_project_details(
  p_project_id uuid,
  p_project_name text,
  p_project_type text,
  p_custom_type_label text default null,
  p_default_currency text default null,
  p_export_language text default 'en',
  p_timezone text default null,
  p_start_date date default null,
  p_target_completion_date date default null,
  p_short_description text default null,
  p_internal_notes text default null,
  p_tags text[] default '{}'
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_lifecycle text;
  v_client_status text;
  v_project public.projects;
begin
  select p.workspace_id, p.readiness_status, p.lifecycle_status, cb.status
    into v_workspace_id, v_from_status, v_lifecycle, v_client_status
  from public.projects p
  join public.client_businesses cb on cb.id = p.client_business_id
  where p.id = p_project_id
  for update of p;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  if v_lifecycle = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;
  if v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived and read-only: restore the client first';
  end if;

  update public.projects
    set project_name = p_project_name,
        project_type = p_project_type,
        custom_type_label = p_custom_type_label,
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

revoke execute on function public.update_project_details(uuid, text, text, text, text, text, text, date, date, text, text, text[]) from public, anon, service_role;
grant execute on function public.update_project_details(uuid, text, text, text, text, text, text, date, date, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Project lifecycle
-- ---------------------------------------------------------------------

-- Locks the client (FOR SHARE) then the project (FOR UPDATE) and checks
-- ownership. Returns the locked project row.
create or replace function private.lock_project_for_lifecycle(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_project public.projects;
begin
  select client_business_id into v_client_id from public.projects where id = p_project_id;
  if v_client_id is null then
    raise exception 'project % not found', p_project_id;
  end if;
  perform 1 from public.client_businesses where id = v_client_id for share;
  select * into v_project from public.projects where id = p_project_id for update;
  if not private.is_workspace_owner(v_project.workspace_id) then
    raise exception 'not authorized';
  end if;
  return v_project;
end;
$$;

revoke execute on function private.lock_project_for_lifecycle(uuid) from public, anon, authenticated, service_role;

create function public.set_project_lifecycle(
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
    update public.client_share_links set revoked_at = now()
      where project_id = p_project_id and revoked_at is null;
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

revoke execute on function public.set_project_lifecycle(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_project_lifecycle(uuid, text, text) to authenticated;

-- Restores an archived project to the status it had when it was archived
-- (ON_HOLD if that is not on record), and only under an ACTIVE client.
create function public.restore_project(p_project_id uuid, p_reason text default null)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_client_status text;
  v_to text;
begin
  v_project := private.lock_project_for_lifecycle(p_project_id);

  if v_project.lifecycle_status <> 'ARCHIVED' then
    raise exception 'only an archived project can be restored';
  end if;

  select status into v_client_status from public.client_businesses where id = v_project.client_business_id;
  if v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived: restore the client first';
  end if;

  select coalesce(
    (select e.from_status from public.lifecycle_events e
      where e.entity_id = p_project_id and e.event_type = 'ARCHIVED'
      order by e.created_at desc limit 1),
    'ON_HOLD'
  ) into v_to;

  update public.projects set lifecycle_status = v_to where id = p_project_id
    returning * into v_project;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    'RESTORED', 'ARCHIVED', v_to, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  return v_project;
end;
$$;

revoke execute on function public.restore_project(uuid, text) from public, anon, service_role;
grant execute on function public.restore_project(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Client archive / restore
-- ---------------------------------------------------------------------

create function public.archive_client_business(p_client_business_id uuid, p_reason text default null)
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

  -- Client then project, the shared lock order. Holding every project row
  -- serializes this with in-flight writes to those projects.
  perform 1 from public.projects where client_business_id = p_client_business_id for update;

  select count(*) into v_open from public.projects
  where client_business_id = p_client_business_id and lifecycle_status in ('ACTIVE', 'ON_HOLD');
  if v_open > 0 then
    raise exception 'this client/business has % active or on-hold project(s): complete or archive them first', v_open;
  end if;

  update public.client_businesses set status = 'ARCHIVED', archived_at = now()
    where id = p_client_business_id
    returning * into v_client;

  update public.client_share_links set revoked_at = now()
    where revoked_at is null
      and project_id in (select id from public.projects where client_business_id = p_client_business_id);

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'ARCHIVED', 'ACTIVE', 'ARCHIVED', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  return v_client;
end;
$$;

revoke execute on function public.archive_client_business(uuid, text) from public, anon, service_role;
grant execute on function public.archive_client_business(uuid, text) to authenticated;

create function public.restore_client_business(p_client_business_id uuid, p_reason text default null)
returns public.client_businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.client_businesses;
begin
  select * into v_client from public.client_businesses where id = p_client_business_id for update;
  if v_client.id is null then
    raise exception 'client/business % not found', p_client_business_id;
  end if;
  if not private.is_workspace_owner(v_client.workspace_id) then
    raise exception 'not authorized';
  end if;
  if v_client.status <> 'ARCHIVED' then
    raise exception 'only an archived client/business can be restored';
  end if;

  update public.client_businesses set status = 'ACTIVE', archived_at = null
    where id = p_client_business_id
    returning * into v_client;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'RESTORED', 'ARCHIVED', 'ACTIVE', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  return v_client;
end;
$$;

revoke execute on function public.restore_client_business(uuid, text) from public, anon, service_role;
grant execute on function public.restore_client_business(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Permanent deletion
-- ---------------------------------------------------------------------

-- What keeps a project from being permanently deleted; empty when none.
create or replace function public.project_retained_history(p_project_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select array_remove(array[
    case when exists (select 1 from public.project_exports where project_id = p_project_id)
      then 'approved exports' end,
    case when exists (select 1 from public.project_approval_events where project_id = p_project_id)
      then 'approval history' end,
    case when exists (select 1 from public.financial_records where project_id = p_project_id)
      then 'financial records' end,
    case when exists (select 1 from public.creatives where project_id = p_project_id and status in ('APPROVED', 'PUBLISHED'))
      then 'approved or published creatives' end
  ], null)
$$;

revoke execute on function public.project_retained_history(uuid) from public, anon, service_role;
grant execute on function public.project_retained_history(uuid) to authenticated;

create function public.delete_project_permanently(p_project_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_retained text[];
begin
  v_project := private.lock_project_for_lifecycle(p_project_id);

  if not private.has_recent_password_and_totp() then
    raise exception 'permanent deletion requires a password + TOTP sign-in within the last 5 minutes'
      using errcode = '42501';
  end if;
  if v_project.lifecycle_status <> 'ARCHIVED' then
    raise exception 'only an archived project can be permanently deleted';
  end if;
  if v_project.archived_at > now() - interval '30 days' then
    raise exception 'an archived project can be permanently deleted 30 days after archiving (on %)',
      to_char((v_project.archived_at + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD');
  end if;
  if p_confirm_name is distinct from v_project.project_name then
    raise exception 'type the project name exactly to confirm permanent deletion';
  end if;

  v_retained := public.project_retained_history(p_project_id);
  if cardinality(v_retained) > 0 then
    raise exception 'this project must be retained because it has % -- that history is never deleted',
      array_to_string(v_retained, ', ');
  end if;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, actor_id
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    'PERMANENTLY_DELETED', 'ARCHIVED', null, auth.uid()
  );

  -- Cascades to answers, evidence, targets, draft creatives and share links.
  delete from public.projects where id = p_project_id;
end;
$$;

revoke execute on function public.delete_project_permanently(uuid, text) from public, anon, service_role;
grant execute on function public.delete_project_permanently(uuid, text) to authenticated;

create function public.delete_client_business_permanently(p_client_business_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.client_businesses;
  v_projects int;
begin
  select * into v_client from public.client_businesses where id = p_client_business_id for update;
  if v_client.id is null then
    raise exception 'client/business % not found', p_client_business_id;
  end if;
  if not private.is_workspace_owner(v_client.workspace_id) then
    raise exception 'not authorized';
  end if;
  if not private.has_recent_password_and_totp() then
    raise exception 'permanent deletion requires a password + TOTP sign-in within the last 5 minutes'
      using errcode = '42501';
  end if;
  if v_client.status <> 'ARCHIVED' then
    raise exception 'only an archived client/business can be permanently deleted';
  end if;
  if v_client.archived_at > now() - interval '30 days' then
    raise exception 'an archived client/business can be permanently deleted 30 days after archiving (on %)',
      to_char((v_client.archived_at + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD');
  end if;
  if p_confirm_name is distinct from v_client.display_name then
    raise exception 'type the client/business name exactly to confirm permanent deletion';
  end if;

  select count(*) into v_projects from public.projects where client_business_id = p_client_business_id;
  if v_projects > 0 then
    raise exception 'this client/business still has % project(s): they are retained or must be deleted first', v_projects;
  end if;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, actor_id
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'PERMANENTLY_DELETED', 'ARCHIVED', null, auth.uid()
  );

  delete from public.client_businesses where id = p_client_business_id;
end;
$$;

revoke execute on function public.delete_client_business_permanently(uuid, text) from public, anon, service_role;
grant execute on function public.delete_client_business_permanently(uuid, text) to authenticated;
