-- Evidence/file metadata, per BUILD_READINESS_QUESTIONNAIRE.md section J
-- and CLAUDE_CODE_BUILD_HANDOFF.md "Evidence and files". The MVP has no
-- Google Drive API integration -- this stores safe metadata and an
-- external link only, never the binary itself (files up to 1GB stay in
-- Drive, per the linked-file policy).

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  category text not null check (
    category in (
      'brand', 'evidence', 'reports', 'financial', 'creative',
      'seo', 'ads', 'website', 'contracts', 'exports'
    )
  ),
  original_filename text,
  external_url text not null,
  version int not null default 1,
  verification_status text not null default 'UNVERIFIED' check (
    verification_status in ('VERIFIED', 'OWNER_REPORTED', 'CLIENT_REPORTED', 'UNVERIFIED')
  ),
  evidence_date date,
  notes text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index evidence_items_project_id_idx on public.evidence_items (project_id, category);
create index evidence_items_workspace_id_idx on public.evidence_items (workspace_id);

create trigger evidence_items_set_updated_at
  before update on public.evidence_items
  for each row
  execute function private.set_updated_at();

create or replace function private.set_evidence_item_workspace_id()
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

create trigger evidence_items_set_workspace_id
  before insert or update on public.evidence_items
  for each row
  execute function private.set_evidence_item_workspace_id();

alter table public.evidence_items enable row level security;

create policy evidence_items_select
  on public.evidence_items
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy evidence_items_insert
  on public.evidence_items
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy evidence_items_update
  on public.evidence_items
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

create policy evidence_items_delete
  on public.evidence_items
  for delete
  to authenticated
  using (private.is_workspace_owner(workspace_id));
