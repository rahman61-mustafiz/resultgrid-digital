-- Approval/version/invalidation ledger.
--
-- Until now, a project's readiness state lived only in the single mutable
-- `projects.readiness_status` column: every transition (submitted for
-- review, approved, silently invalidated by a later edit) overwrote the
-- last one with no record of who did it, when, or why. That made it
-- impossible to answer "was this project ever actually approved by the
-- Owner, and did anything change after that approval before the export
-- was sent to the client" -- exactly the kind of history
-- BUILD_READINESS_QUESTIONNAIRE.md requires be preserved, and the project
-- brief's Do's/Don'ts explicitly forbid hard-deleting approval/export
-- history. This table is the append-only record of that lifecycle,
-- alongside `project_exports` (the immutable content snapshots) and
-- `security_events` (account/session-level audit).

create table public.project_approval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  event_type text not null check (
    event_type in ('SUBMITTED_FOR_REVIEW', 'APPROVED', 'INVALIDATED', 'EXPORTED')
  ),
  from_status text,
  to_status text,
  -- Only set for EXPORTED events; the version of project_exports this
  -- event corresponds to. Not a DB foreign key (project_exports has no
  -- natural single-column key to reference), tied together in application
  -- code by project_id + version instead.
  export_version int,
  reason text,

  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index project_approval_events_project_id_idx
  on public.project_approval_events (project_id, created_at desc);

create or replace function private.set_project_approval_event_workspace_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select workspace_id into new.workspace_id
  from public.projects
  where id = new.project_id;

  if new.workspace_id is null then
    raise exception 'project_id % does not reference an existing project', new.project_id;
  end if;

  return new;
end;
$$;

create trigger project_approval_events_set_workspace_id
  before insert on public.project_approval_events
  for each row
  execute function private.set_project_approval_event_workspace_id();

-- Append-only: no UPDATE or DELETE, at the trigger level (covers the
-- service-role client too, not just RLS) as well as via RLS policy
-- omission for the authenticated role.
create trigger project_approval_events_forbid_update
  before update on public.project_approval_events
  for each row
  execute function private.forbid_mutation();

create trigger project_approval_events_forbid_delete
  before delete on public.project_approval_events
  for each row
  execute function private.forbid_mutation();

alter table public.project_approval_events enable row level security;

create policy project_approval_events_select
  on public.project_approval_events
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy project_approval_events_insert
  on public.project_approval_events
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

-- No UPDATE/DELETE policy: immutable, matching project_exports and
-- security_events.
