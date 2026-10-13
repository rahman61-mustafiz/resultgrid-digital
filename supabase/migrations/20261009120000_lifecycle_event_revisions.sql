-- Follow-up to 20261009100000_lifecycle_backstops.sql /
-- 20261009110000_client_edit_invalidation_scope.sql, after the second
-- review (REVIEW_2026-10-08_PRIORITY7_FOLLOWUP.md).
--
-- The status backstops matched a history row by created_at = now() and
-- ordered archive events by (created_at, id). Inside one transaction every
-- default created_at is the same (now() is the transaction start) and ids
-- are random UUIDs, so:
--   * two archive/restore cycles in one transaction could restore to the
--     status before the FIRST archive, not the latest one; and
--   * a direct status update could reuse an earlier event from the same
--     transaction, changing status without a new history row.
--
-- Now:
--   * lifecycle_events.seq (identity) is the insertion order; "the latest
--     archive" is the highest seq.
--   * lifecycle_events.txid records the inserting transaction; "in this
--     transaction" is txid = the current transaction id, not a timestamp.
--   * Every status change bumps projects.lifecycle_revision /
--     client_businesses.status_revision by exactly one, and must be backed
--     by the event carrying that revision (unique per entity), from this
--     transaction. An event therefore backs exactly one transition and
--     can't be replayed.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------

-- Adding columns rewrites no rows through triggers, so the append-only
-- guards are unaffected. Existing rows get seq in physical order and no
-- txid / revision.
alter table public.lifecycle_events add column seq bigint generated always as identity;
alter table public.lifecycle_events add column txid bigint;
alter table public.lifecycle_events alter column txid set default (pg_current_xact_id()::text::bigint);
alter table public.lifecycle_events add column entity_revision integer;

create unique index lifecycle_events_entity_revision_key
  on public.lifecycle_events (entity_type, entity_id, entity_revision)
  where entity_revision is not null;
create index lifecycle_events_entity_seq_idx on public.lifecycle_events (entity_id, seq desc);

alter table public.projects add column lifecycle_revision integer not null default 0;
alter table public.client_businesses add column status_revision integer not null default 0;

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------

-- Used by the delete guards: was this event recorded by this transaction?
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
    and e.txid = pg_current_xact_id()::text::bigint
  order by e.seq desc
  limit 1
$$;

-- The event that backs one specific transition: this entity, this
-- revision, these statuses, recorded by this transaction.
create or replace function private.lifecycle_transition_event(
  p_entity_type text,
  p_entity_id uuid,
  p_revision integer,
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
    and e.entity_revision = p_revision
    and e.event_type = p_event_type
    and e.from_status is not distinct from p_from
    and e.to_status is not distinct from p_to
    and e.txid = pg_current_xact_id()::text::bigint
$$;

revoke execute on function private.lifecycle_transition_event(text, uuid, integer, text, text, text)
  from public, anon, authenticated, service_role;

-- The status a project had before its latest archive.
create or replace function private.project_status_before_last_archive(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.from_status from public.lifecycle_events e
      where e.entity_type = 'PROJECT' and e.entity_id = p_project_id and e.event_type = 'ARCHIVED'
      order by e.seq desc limit 1),
    'ON_HOLD'
  )
$$;

revoke execute on function private.project_status_before_last_archive(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Table backstops
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
    if old.readiness_status = 'APPROVED' and new.readiness_status = 'READY_FOR_REVIEW'
       and (to_jsonb(new) - 'readiness_status' - 'updated_at') = (to_jsonb(old) - 'readiness_status' - 'updated_at') then
      return new;
    end if;
    raise exception 'this project is archived and read-only: restore it first';
  end if;

  if new.lifecycle_status is not distinct from old.lifecycle_status then
    if new.lifecycle_revision is distinct from old.lifecycle_revision then
      raise exception 'the lifecycle revision changes only with a recorded status change';
    end if;
  else
    if new.lifecycle_revision is distinct from old.lifecycle_revision + 1 then
      raise exception 'project status changes only through set_project_lifecycle / restore_project, which record them';
    end if;
    if old.lifecycle_status = 'ARCHIVED' then
      v_event_type := 'RESTORED';
      v_restore_to := private.project_status_before_last_archive(new.id);
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
    from private.lifecycle_transition_event(
      'PROJECT', new.id, new.lifecycle_revision, v_event_type, old.lifecycle_status, new.lifecycle_status
    ) r;
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

  if new.status is not distinct from old.status then
    if new.status_revision is distinct from old.status_revision then
      raise exception 'the status revision changes only with a recorded status change';
    end if;
  else
    if new.status_revision is distinct from old.status_revision + 1
       or not exists (
         select 1 from private.lifecycle_transition_event(
           'CLIENT_BUSINESS', new.id, new.status_revision,
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

-- ---------------------------------------------------------------------
-- 4. RPCs: record the next revision, then apply it
-- ---------------------------------------------------------------------

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

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id, entity_revision
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    case when p_to_status = 'ARCHIVED' then 'ARCHIVED' else 'LIFECYCLE_CHANGED' end,
    v_from, p_to_status, v_reason, auth.uid(), v_project.lifecycle_revision + 1
  );

  update public.projects
    set lifecycle_status = p_to_status, lifecycle_revision = lifecycle_revision + 1
    where id = p_project_id
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

  v_to := private.project_status_before_last_archive(p_project_id);

  insert into public.lifecycle_events (
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id, entity_revision
  ) values (
    v_project.workspace_id, 'PROJECT', p_project_id, v_project.project_name,
    'RESTORED', 'ARCHIVED', v_to, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), v_project.lifecycle_revision + 1
  );

  update public.projects
    set lifecycle_status = v_to, lifecycle_revision = lifecycle_revision + 1
    where id = p_project_id
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
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id, entity_revision
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'ARCHIVED', 'ACTIVE', 'ARCHIVED', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), v_client.status_revision + 1
  );

  -- Share links are revoked by client_businesses_revoke_links_on_archive.
  update public.client_businesses
    set status = 'ARCHIVED', archived_at = now(), status_revision = status_revision + 1
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
    workspace_id, entity_type, entity_id, entity_name, event_type, from_status, to_status, reason, actor_id, entity_revision
  ) values (
    v_client.workspace_id, 'CLIENT_BUSINESS', p_client_business_id, v_client.display_name,
    'RESTORED', 'ARCHIVED', 'ACTIVE', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), v_client.status_revision + 1
  );

  update public.client_businesses
    set status = 'ACTIVE', archived_at = null, status_revision = status_revision + 1
    where id = p_client_business_id
    returning * into v_client;

  return v_client;
end;
$$;
