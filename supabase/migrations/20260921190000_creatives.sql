-- Creative workflow, per CLAUDE_CODE_BUILD_HANDOFF.md "Creative workflow":
-- DRAFT -> INTERNAL_REVIEW -> CLIENT_REVIEW -> APPROVED -> PUBLISHED, with
-- a CHANGES_REQUESTED branch. Version history is an append-only JSONB
-- array on the row (matching financial_records.correction_history),
-- rather than a separate versions table -- simpler, and this is a single-
-- Owner MVP where full separate-row version diffing isn't needed yet.

create table public.creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  title text not null check (char_length(btrim(title)) > 0),
  channel text,
  format text,
  copy text,
  asset_url text,
  planned_date date,

  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'INTERNAL_REVIEW', 'CLIENT_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED')
  ),
  version int not null default 1,
  -- Each entry: {version, copy, asset_url, changed_at, changed_by}.
  version_history jsonb not null default '[]'::jsonb,

  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approval_note text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index creatives_project_id_idx on public.creatives (project_id, status);

create trigger creatives_set_updated_at
  before update on public.creatives
  for each row
  execute function private.set_updated_at();

create or replace function private.set_creative_workspace_id()
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

create trigger creatives_set_workspace_id
  before insert or update on public.creatives
  for each row
  execute function private.set_creative_workspace_id();

alter table public.creatives enable row level security;

create policy creatives_select
  on public.creatives
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy creatives_insert
  on public.creatives
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy creatives_update
  on public.creatives
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

create policy creatives_delete
  on public.creatives
  for delete
  to authenticated
  using (private.is_workspace_owner(workspace_id));
