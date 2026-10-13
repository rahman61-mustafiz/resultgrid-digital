-- Hardening for 20261008100000_lifecycle_archive_delete_rules.sql and
-- 20261008110000_share_links_follow_archive.sql, after the independent
-- review of 8 October 2026 (REVIEW_2026-10-08_PRIORITY7.md):
--
-- 1. Parent deletes. service_role (and anon/authenticated, blocked only by
--    RLS) held DELETE on projects, client_businesses and workspaces, so a
--    project could be deleted without reauth, typed name, the 30-day wait or
--    a deletion record -- and its financial records cascaded away. DELETE is
--    revoked, and BEFORE DELETE backstops on projects and client_businesses
--    refuse any delete that delete_*_permanently did not record in this
--    same transaction (only those RPCs can write lifecycle_events), or that
--    would break the retention / 30-day rules. TRUNCATE (which skips row
--    triggers and RLS) is revoked from every API role on every table.
-- 2. Reparenting. A child row (creative, answer, evidence, financial record,
--    target, share link) can no longer be moved to another project, which
--    let an archived project's creative be moved into an active project.
-- 3. Creative retention. Approval/publication of a creative is recorded in
--    the append-only creative_approval_history the moment it happens, and
--    retention is based on that history -- editing an approved creative
--    (which moves it back to CHANGES_REQUESTED) no longer makes its project
--    deletable. A creative with such history can't be deleted either.
-- 4. Lifecycle backstop. The projects / client_businesses table triggers now
--    enforce the transition matrix, the restore target and the reopen
--    reason themselves, and require the matching lifecycle_events row from
--    this same transaction, so no write path -- service role, database
--    owner, a future function -- changes a status without the rules and
--    the history. Archiving revokes share links from the trigger too.
-- 5. Lock order. Archive paths now lock the affected share links BEFORE the
--    project row(s), the same order a direct share-link update takes (link
--    row, then the project FOR SHARE in assert_project_accepts_work), so an
--    archive and a concurrent link reactivation can't deadlock.
--    update_project_details now locks client then project like every other
--    RPC. The order is: client -> share links -> project -> other children.
-- 6. Notes/tags. update_project_details invalidates an approval only when a
--    field the export is generated from changes (the fingerprint inputs in
--    private.project_export_inputs), not for notes, tags, dates, timezone
--    or description (spec D: internal notes/tags don't invalidate).
--
-- The database owner can still disable triggers; the QA purge scripts do
-- that inside one transaction for synthetic QA fixtures only.

-- ---------------------------------------------------------------------
-- 1a. Privileges
-- ---------------------------------------------------------------------

revoke delete on public.projects, public.client_businesses, public.workspaces
  from anon, authenticated, service_role;
revoke truncate on all tables in schema public from anon, authenticated, service_role;
-- Every policy is `to authenticated`; anon never writes a table directly.
revoke insert, update, delete on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- 3. Creative approval/publication history (needed by the delete checks)
-- ---------------------------------------------------------------------

create table public.creative_approval_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- No foreign keys: the record outlives the creative and must keep its
  -- project from being treated as having no approved work.
  project_id uuid not null,
  creative_id uuid not null,
  status text not null check (status in ('APPROVED', 'PUBLISHED')),
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index creative_approval_history_project_idx on public.creative_approval_history (project_id);
create index creative_approval_history_creative_idx on public.creative_approval_history (creative_id);

alter table public.creative_approval_history enable row level security;

create policy creative_approval_history_select
  on public.creative_approval_history
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

revoke insert, update, delete, truncate on public.creative_approval_history
  from public, anon, authenticated, service_role;
grant select on public.creative_approval_history to authenticated;

create trigger creative_approval_history_forbid_update
  before update on public.creative_approval_history
  for each row execute function private.forbid_mutation();
create trigger creative_approval_history_forbid_delete
  before delete on public.creative_approval_history
  for each row execute function private.forbid_mutation();
create trigger creative_approval_history_forbid_truncate
  before truncate on public.creative_approval_history
  for each statement execute function private.forbid_mutation();

create or replace function private.record_creative_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('APPROVED', 'PUBLISHED')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.creative_approval_history (workspace_id, project_id, creative_id, status, actor_id)
    values (new.workspace_id, new.project_id, new.id, new.status, auth.uid());
  end if;
  return null;
end;
$$;

create trigger creatives_record_approval
  after insert or update of status on public.creatives
  for each row execute function private.record_creative_approval();

-- Existing approved/published creatives, and ones approved before and
-- since edited (approved_at is cleared by the edit, so only the former
-- are recoverable from current rows).
insert into public.creative_approval_history (workspace_id, project_id, creative_id, status, actor_id, created_at)
select c.workspace_id, c.project_id, c.id, c.status, c.approved_by, coalesce(c.approved_at, c.updated_at, now())
from public.creatives c
where c.status in ('APPROVED', 'PUBLISHED');

create or replace function private.guard_creative_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.creative_approval_history h where h.creative_id = old.id) then
    raise exception 'an approved or published creative is kept as history and cannot be deleted';
  end if;
  return old;
end;
$$;

create trigger creatives_guard_delete
  before delete on public.creatives
  for each row execute function private.guard_creative_delete();

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
    -- Ever approved or published, not just currently: see
    -- creative_approval_history.
    case when exists (select 1 from public.creative_approval_history where project_id = p_project_id)
      then 'approved or published creatives' end
  ], null)
$$;

-- ---------------------------------------------------------------------
-- 1b. Parent delete backstops
-- ---------------------------------------------------------------------

-- True when this transaction recorded the given lifecycle event. Only the
-- SECURITY DEFINER lifecycle RPCs can insert lifecycle_events (every API
-- role's INSERT is revoked), and created_at defaults to now() -- the
-- transaction's start time -- so a row from this transaction matches.
create or replace function private.lifecycle_event_in_this_transaction(
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_from text,
  p_to text
)
returns table (reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.reason
  from public.lifecycle_events e
  where e.entity_type = p_entity_type
    and e.entity_id = p_entity_id
    and e.event_type = p_event_type
    and e.from_status is not distinct from p_from
    and e.to_status is not distinct from p_to
    and e.created_at = now()
  order by e.id
  limit 1
$$;

revoke execute on function private.lifecycle_event_in_this_transaction(text, uuid, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.guard_project_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retained text[];
begin
  if not exists (
    select 1 from private.lifecycle_event_in_this_transaction('PROJECT', old.id, 'PERMANENTLY_DELETED', 'ARCHIVED', null)
  ) then
    raise exception 'a project can only be removed with delete_project_permanently (archived 30+ days, exact name, recent password + TOTP)';
  end if;
  if old.lifecycle_status <> 'ARCHIVED' or old.archived_at is null or old.archived_at > now() - interval '30 days' then
    raise exception 'only a project archived for at least 30 days can be permanently deleted';
  end if;
  v_retained := public.project_retained_history(old.id);
  if cardinality(v_retained) > 0 then
    raise exception 'this project must be retained because it has % -- that history is never deleted',
      array_to_string(v_retained, ', ');
  end if;
  return old;
end;
$$;

create trigger projects_guard_delete
  before delete on public.projects
  for each row execute function private.guard_project_delete();

create or replace function private.guard_client_business_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.lifecycle_event_in_this_transaction('CLIENT_BUSINESS', old.id, 'PERMANENTLY_DELETED', 'ARCHIVED', null)
  ) then
    raise exception 'a client/business can only be removed with delete_client_business_permanently (archived 30+ days, exact name, recent password + TOTP)';
  end if;
  if old.status <> 'ARCHIVED' or old.archived_at is null or old.archived_at > now() - interval '30 days' then
    raise exception 'only a client/business archived for at least 30 days can be permanently deleted';
  end if;
  -- Its projects are protected by projects_client_business_id_fkey (ON
  -- DELETE RESTRICT) and by projects_guard_delete.
  return old;
end;
$$;

create trigger client_businesses_guard_delete
  before delete on public.client_businesses
  for each row execute function private.guard_client_business_delete();

-- ---------------------------------------------------------------------
-- 2. No reparenting of a project's rows
-- ---------------------------------------------------------------------

create or replace function private.forbid_project_reparent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'a % cannot be moved to another project', replace(tg_table_name, '_', ' ');
  end if;
  return new;
end;
$$;

create trigger project_answers_forbid_reparent
  before update of project_id on public.project_answers
  for each row execute function private.forbid_project_reparent();
create trigger evidence_items_forbid_reparent
  before update of project_id on public.evidence_items
  for each row execute function private.forbid_project_reparent();
create trigger financial_records_forbid_reparent
  before update of project_id on public.financial_records
  for each row execute function private.forbid_project_reparent();
create trigger project_targets_forbid_reparent
  before update of project_id on public.project_targets
  for each row execute function private.forbid_project_reparent();
create trigger creatives_forbid_reparent
  before update of project_id on public.creatives
  for each row execute function private.forbid_project_reparent();
create trigger client_share_links_forbid_reparent
  before update of project_id on public.client_share_links
  for each row execute function private.forbid_project_reparent();

-- ---------------------------------------------------------------------
-- 4. Lifecycle backstops on the parent rows
-- ---------------------------------------------------------------------

create or replace function private.enforce_project_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_status text;
  v_restore_to text;
  v_event_type text;
  v_reason text;
  v_recorded boolean;
begin
  if new.client_business_id is distinct from old.client_business_id then
    raise exception 'a project cannot be moved to another client/business: archive it and create it again under the right one';
  end if;
  if old.lifecycle_status = 'ARCHIVED' and new.lifecycle_status = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;

  if new.lifecycle_status is distinct from old.lifecycle_status then
    if old.lifecycle_status = 'ARCHIVED' then
      v_event_type := 'RESTORED';
      select coalesce(
        (select e.from_status from public.lifecycle_events e
          where e.entity_type = 'PROJECT' and e.entity_id = new.id and e.event_type = 'ARCHIVED'
          order by e.created_at desc, e.id desc limit 1),
        'ON_HOLD'
      ) into v_restore_to;
      if new.lifecycle_status is distinct from v_restore_to then
        raise exception 'a restored project returns to the status it had before archiving (%)', v_restore_to;
      end if;
    else
      if not private.project_lifecycle_transition_allowed(old.lifecycle_status, new.lifecycle_status) then
        raise exception 'a project cannot move from % to %', old.lifecycle_status, new.lifecycle_status;
      end if;
      v_event_type := case when new.lifecycle_status = 'ARCHIVED' then 'ARCHIVED' else 'LIFECYCLE_CHANGED' end;
    end if;

    select true, r.reason into v_recorded, v_reason
    from private.lifecycle_event_in_this_transaction('PROJECT', new.id, v_event_type, old.lifecycle_status, new.lifecycle_status) r;
    if v_recorded is null then
      raise exception 'project status changes only through set_project_lifecycle / restore_project, which record them';
    end if;
    if old.lifecycle_status = 'COMPLETED' and new.lifecycle_status = 'ACTIVE'
       and nullif(btrim(coalesce(v_reason, '')), '') is null then
      raise exception 'reopening a completed project requires a reason';
    end if;
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

create or replace function private.enforce_client_business_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open int;
begin
  if old.status = 'ARCHIVED' and new.status = 'ARCHIVED' then
    raise exception 'this client/business is archived and read-only: restore it first';
  end if;

  if new.status is distinct from old.status then
    if not exists (
      select 1 from private.lifecycle_event_in_this_transaction(
        'CLIENT_BUSINESS', new.id,
        case when new.status = 'ARCHIVED' then 'ARCHIVED' else 'RESTORED' end,
        old.status, new.status
      )
    ) then
      raise exception 'client/business status changes only through archive_client_business / restore_client_business, which record them';
    end if;
    if new.status = 'ARCHIVED' then
      select count(*) into v_open from public.projects
      where client_business_id = new.id and lifecycle_status in ('ACTIVE', 'ON_HOLD');
      if v_open > 0 then
        raise exception 'this client/business has % active or on-hold project(s): complete or archive them first', v_open;
      end if;
      new.archived_at := coalesce(new.archived_at, now());
    else
      new.archived_at := null;
    end if;
  end if;
  return new;
end;
$$;

-- Archiving revokes share links whatever the write path. The RPCs below
-- have already locked those links, so this adds no new lock order.
create or replace function private.revoke_links_on_project_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.revoke_project_share_links(array[new.id]);
  return null;
end;
$$;

create trigger projects_revoke_links_on_archive
  after update of lifecycle_status on public.projects
  for each row
  when (new.lifecycle_status = 'ARCHIVED' and old.lifecycle_status is distinct from 'ARCHIVED')
  execute function private.revoke_links_on_project_archive();

create or replace function private.revoke_links_on_client_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.revoke_project_share_links(
    array(select id from public.projects where client_business_id = new.id)
  );
  return null;
end;
$$;

create trigger client_businesses_revoke_links_on_archive
  after update of status on public.client_businesses
  for each row
  when (new.status = 'ARCHIVED' and old.status is distinct from 'ARCHIVED')
  execute function private.revoke_links_on_client_archive();

-- ---------------------------------------------------------------------
-- 5. Lock order, and the RPCs recreated to record before they write
-- ---------------------------------------------------------------------

-- client (FOR SHARE) -> the project's share links (FOR UPDATE, when asked)
-- -> project (FOR UPDATE), then ownership.
drop function private.lock_project_for_lifecycle(uuid);

create function private.lock_project_for_lifecycle(p_project_id uuid, p_lock_share_links boolean default false)
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

revoke execute on function private.lock_project_for_lifecycle(uuid, boolean) from public, anon, authenticated, service_role;

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
  v_project := private.lock_project_for_lifecycle(p_project_id, p_to_status = 'ARCHIVED');
  v_from := v_project.lifecycle_status;

  if v_from = 'ARCHIVED' then
    raise exception 'this project is archived: use restore';
  end if;
  if p_to_status = v_from then
    raise exception 'the project is already %', p_to_status;
  end if;
  if not private.project_lifecycle_transition_allowed(v_from, p_to_status) then
    raise exception 'a project cannot move from % to %', v_from, p_to_status;
  end if;
  if v_from = 'COMPLETED' and p_to_status = 'ACTIVE' and v_reason is null then
    raise exception 'reopening a completed project requires a reason';
  end if;

  select status into v_client_status from public.client_businesses where id = v_project.client_business_id;
  if p_to_status <> 'ARCHIVED' and v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived: restore the client first';
  end if;

  -- Recorded first: projects_enforce_update requires this row.
  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    case when p_to_status = 'ARCHIVED' then 'ARCHIVED' else 'LIFECYCLE_CHANGED' end,
    v_from, p_to_status, v_reason, auth.uid()
  );

  -- Share links are revoked by projects_revoke_links_on_archive.
  update public.projects set lifecycle_status = p_to_status where id = p_project_id
    returning * into v_project;

  return v_project;
end;
$$;

create or replace function public.restore_project(p_project_id uuid, p_reason text default null)
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
      where e.entity_type = 'PROJECT' and e.entity_id = p_project_id and e.event_type = 'ARCHIVED'
      order by e.created_at desc, e.id desc limit 1),
    'ON_HOLD'
  ) into v_to;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    'RESTORED', 'ARCHIVED', v_to, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  update public.projects set lifecycle_status = v_to where id = p_project_id
    returning * into v_project;

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

  -- client -> share links -> projects.
  perform 1 from public.client_share_links
    where project_id in (select id from public.projects where client_business_id = p_client_business_id)
    order by id
    for update;
  perform 1 from public.projects where client_business_id = p_client_business_id order by id for update;

  select count(*) into v_open from public.projects
  where client_business_id = p_client_business_id and lifecycle_status in ('ACTIVE', 'ON_HOLD');
  if v_open > 0 then
    raise exception 'this client/business has % active or on-hold project(s): complete or archive them first', v_open;
  end if;

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'ARCHIVED', 'ACTIVE', 'ARCHIVED', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  -- Share links are revoked by client_businesses_revoke_links_on_archive.
  update public.client_businesses set status = 'ARCHIVED', archived_at = now()
    where id = p_client_business_id
    returning * into v_client;

  return v_client;
end;
$$;

create or replace function public.restore_client_business(p_client_business_id uuid, p_reason text default null)
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

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'RESTORED', 'ARCHIVED', 'ACTIVE', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  update public.client_businesses set status = 'ACTIVE', archived_at = null
    where id = p_client_business_id
    returning * into v_client;

  return v_client;
end;
$$;

-- Same checks as before; now locks its share links before the project so
-- the cascade takes them in the shared order.
create or replace function public.delete_project_permanently(p_project_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_retained text[];
begin
  v_project := private.lock_project_for_lifecycle(p_project_id, true);

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

  -- Recorded first: projects_guard_delete requires this row.
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

-- ---------------------------------------------------------------------
-- 5/6. update_project_details: client -> project lock order; approval is
--      invalidated only by a change to an export input
-- ---------------------------------------------------------------------

create or replace function public.update_project_details(
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
  v_before public.projects;
  v_client_status text;
  v_project public.projects;
begin
  v_before := private.lock_project_for_lifecycle(p_project_id);

  if v_before.lifecycle_status = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;
  select status into v_client_status from public.client_businesses where id = v_before.client_business_id;
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

  -- Only the project fields in private.project_export_inputs (what the
  -- approved export was generated from) invalidate an approval.
  if v_before.readiness_status = 'APPROVED'
     and (v_project.project_name, v_project.project_type, v_project.custom_type_label,
          v_project.default_currency, v_project.export_language)
         is distinct from
         (v_before.project_name, v_before.project_type, v_before.custom_type_label,
          v_before.default_currency, v_before.export_language) then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    v_project.readiness_status := 'READY_FOR_REVIEW';
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_project.workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Project details used in the approved export changed after approval.', auth.uid()
    );
  end if;

  return v_project;
end;
$$;
