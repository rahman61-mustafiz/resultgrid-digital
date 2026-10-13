-- Project records. See BUILD_READINESS_QUESTIONNAIRE.md section D and
-- MARKETING_OS_FOUNDATION_BRIEF.md for the confirmed field list, project
-- types, and the lifecycle/readiness state machines.
--
-- Lifecycle and readiness are intentionally separate columns:
--   Lifecycle: ACTIVE -> ON_HOLD -> COMPLETED -> ARCHIVED
--   Readiness: INCOMPLETE -> READY_FOR_REVIEW -> APPROVED
-- A new project starts ACTIVE + INCOMPLETE. Transition legality beyond the
-- allowed value sets is enforced in application/domain logic (it depends on
-- questionnaire completeness across multiple tables, which a CHECK
-- constraint can't see), not in the database.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- ON DELETE RESTRICT: a client/business with projects can't be hard-deleted
  -- out from under them. Archive is the supported path (see B06/B07); a
  -- project never moves to a different parent (B05) -- archive and recreate.
  client_business_id uuid not null references public.client_businesses (id) on delete restrict,

  -- Required fields.
  project_name text not null check (char_length(btrim(project_name)) > 0),
  project_type text not null check (
    project_type in (
      'FULL_DIGITAL_MARKETING',
      'MARKETING_AUDIT_STRATEGY',
      'SEO',
      'SOCIAL_MEDIA',
      'PAID_ADVERTISING',
      'WEBSITE',
      'BRANDING_CREATIVE',
      'CUSTOM'
    )
  ),
  custom_type_label text,
  lifecycle_status text not null default 'ACTIVE'
    check (lifecycle_status in ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')),
  readiness_status text not null default 'INCOMPLETE'
    check (readiness_status in ('INCOMPLETE', 'READY_FOR_REVIEW', 'APPROVED')),
  default_currency text not null check (char_length(default_currency) = 3),
  export_language text not null default 'en',
  timezone text not null,

  -- Optional fields.
  start_date date,
  target_completion_date date,
  short_description text,
  internal_notes text,
  tags text[] not null default '{}',

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_custom_type_requires_label
    check (project_type <> 'CUSTOM' or custom_type_label is not null),
  constraint projects_archived_consistency
    check ((lifecycle_status = 'ARCHIVED') = (archived_at is not null)),
  constraint projects_target_after_start
    check (target_completion_date is null or start_date is null or target_completion_date >= start_date)
);

create index projects_workspace_id_idx on public.projects (workspace_id);
create index projects_client_business_id_idx on public.projects (client_business_id);
create index projects_lifecycle_status_idx on public.projects (workspace_id, lifecycle_status);

create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function private.set_updated_at();

alter table public.projects enable row level security;

create policy projects_select
  on public.projects
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy projects_insert
  on public.projects
  for insert
  to authenticated
  with check (private.can_access_workspace(workspace_id));

create policy projects_update
  on public.projects
  for update
  to authenticated
  using (private.can_access_workspace(workspace_id))
  with check (private.can_access_workspace(workspace_id));

-- No DELETE policy, matching client_businesses: permanent deletion is an
-- Owner-only, reauthenticated, explicitly confirmed action via a server
-- action using the admin client.
