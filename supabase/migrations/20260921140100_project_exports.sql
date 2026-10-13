-- Immutable, versioned PROJECT_CONTEXT.md snapshots. See
-- BUILD_READINESS_QUESTIONNAIRE.md H08/H09: export versions use v01, v02,
-- ...; approved exports are immutable and may be archived but never
-- hard-deleted through the app. Regenerating creates a new version; old
-- ones remain historical evidence.

create table public.project_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null,
  content text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users (id) on delete set null,

  unique (project_id, version)
);

create index project_exports_project_id_idx on public.project_exports (project_id, version desc);

create or replace function private.set_project_export_workspace_id()
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

create trigger project_exports_set_workspace_id
  before insert on public.project_exports
  for each row
  execute function private.set_project_export_workspace_id();

create trigger project_exports_forbid_update
  before update on public.project_exports
  for each row
  execute function private.forbid_mutation();

alter table public.project_exports enable row level security;

create policy project_exports_select
  on public.project_exports
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy project_exports_insert
  on public.project_exports
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

-- No UPDATE/DELETE policy: immutable, matching security_events.
