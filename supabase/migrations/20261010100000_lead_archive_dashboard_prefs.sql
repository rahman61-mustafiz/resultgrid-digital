-- Priority #10 (BUILD_READINESS_QUESTIONNAIRE.md I02, I04).
--
-- 1. Leads can be archived and restored, each with a required reason
--    (I04: leads support search, filter, sort and archive). An archived
--    lead is read-only until restored; leads are never deleted.
-- 2. The dashboard's cards are Owner-configurable (I02): each user's
--    hidden cards are stored per user. The truthfulness warnings are not a
--    card and can't be hidden.

begin;

-- ---------------------------------------------------------------------
-- 1. Lead archive
-- ---------------------------------------------------------------------

alter table public.leads
  add column archived_at timestamptz,
  add column archived_by uuid,
  add column archive_reason text,
  add constraint leads_archive_fields check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (archived_at is not null and nullif(btrim(archive_reason), '') is not null)
  );

create index leads_archived_idx on public.leads (workspace_id, archived_at);

-- Archive/restore only through set_lead_archived; an archived lead can't
-- be edited (stage, follow-ups, details) until it is restored.
create or replace function private.guard_lead_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.archived_at, new.archived_by, new.archive_reason)
       is distinct from (old.archived_at, old.archived_by, old.archive_reason)
     and coalesce(current_setting('rg.lead_archive', true), '') <> 'on' then
    raise exception 'archive or restore a lead with its Archive/Restore control';
  end if;
  if old.archived_at is not null and new.archived_at is not null then
    raise exception 'this lead is archived and read-only: restore it first';
  end if;
  return new;
end;
$$;

create trigger leads_guard_update
  before update on public.leads
  for each row execute function private.guard_lead_update();

create or replace function public.set_lead_archived(p_lead_id uuid, p_archived boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id;
  end if;
  if not private.is_workspace_owner(v_lead.workspace_id) then
    raise exception 'not authorized';
  end if;
  if v_reason is null then
    raise exception 'give a reason for % this lead', case when p_archived then 'archiving' else 'restoring' end;
  end if;
  if p_archived and v_lead.archived_at is not null then
    raise exception 'this lead is already archived';
  end if;
  if not p_archived and v_lead.archived_at is null then
    raise exception 'this lead is not archived';
  end if;

  perform set_config('rg.lead_archive', 'on', true);
  if p_archived then
    update public.leads
      set archived_at = now(), archived_by = auth.uid(), archive_reason = v_reason
      where id = p_lead_id;
  else
    update public.leads
      set archived_at = null, archived_by = null, archive_reason = null
      where id = p_lead_id;
  end if;
  perform set_config('rg.lead_archive', '', true);

  insert into public.lead_archive_events (workspace_id, lead_id, event_type, reason, actor_id)
  values (v_lead.workspace_id, p_lead_id, case when p_archived then 'ARCHIVED' else 'RESTORED' end, v_reason, auth.uid());
end;
$$;

-- Append-only history of archive/restore (the lead row only holds the
-- current state).
create table public.lead_archive_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  event_type text not null check (event_type in ('ARCHIVED', 'RESTORED')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index lead_archive_events_lead_idx on public.lead_archive_events (lead_id, seq desc);

alter table public.lead_archive_events enable row level security;

create policy lead_archive_events_select
  on public.lead_archive_events
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

revoke insert, update, delete, truncate on public.lead_archive_events
  from public, anon, authenticated, service_role;
grant select on public.lead_archive_events to authenticated;

create trigger lead_archive_events_forbid_update
  before update on public.lead_archive_events
  for each row execute function private.forbid_mutation();
create trigger lead_archive_events_forbid_delete
  before delete on public.lead_archive_events
  for each row execute function private.forbid_mutation();
create trigger lead_archive_events_forbid_truncate
  before truncate on public.lead_archive_events
  for each statement execute function private.forbid_mutation();

revoke execute on function public.set_lead_archived(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.set_lead_archived(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Dashboard card preferences
-- ---------------------------------------------------------------------

create table public.dashboard_preferences (
  user_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  hidden_cards text[] not null default '{}'
    check (hidden_cards <@ array['overview', 'money', 'profit', 'targets', 'attention', 'leads']::text[]),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_preferences enable row level security;

create policy dashboard_preferences_select_own
  on public.dashboard_preferences
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy dashboard_preferences_insert_own
  on public.dashboard_preferences
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.is_workspace_owner(workspace_id));

create policy dashboard_preferences_update_own
  on public.dashboard_preferences
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_workspace_owner(workspace_id));

revoke delete, truncate on public.dashboard_preferences from public, anon, authenticated;
revoke all on public.dashboard_preferences from anon;
grant select, insert, update on public.dashboard_preferences to authenticated;

commit;
