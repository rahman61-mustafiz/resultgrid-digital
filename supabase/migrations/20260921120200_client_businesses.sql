-- Client/Business records (owned businesses and external clients share one
-- table, distinguished by record_type). See
-- BUILD_READINESS_QUESTIONNAIRE.md section D for the confirmed field list.

create table public.client_businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- Required fields.
  display_name text not null check (char_length(btrim(display_name)) > 0),
  record_type text not null check (record_type in ('OWNED_BUSINESS', 'EXTERNAL_CLIENT')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  country text not null,
  timezone text not null,

  -- Optional fields.
  legal_name text,
  website text,
  industry text,
  primary_contact_name text,
  email text,
  phone text,
  address text,
  logo_url text,
  internal_notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_businesses_archived_consistency
    check ((status = 'ARCHIVED') = (archived_at is not null))
);

create index client_businesses_workspace_id_idx on public.client_businesses (workspace_id);
create index client_businesses_status_idx on public.client_businesses (workspace_id, status);

create trigger client_businesses_set_updated_at
  before update on public.client_businesses
  for each row
  execute function private.set_updated_at();

alter table public.client_businesses enable row level security;

create policy client_businesses_select
  on public.client_businesses
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy client_businesses_insert
  on public.client_businesses
  for insert
  to authenticated
  with check (private.can_access_workspace(workspace_id));

create policy client_businesses_update
  on public.client_businesses
  for update
  to authenticated
  using (private.can_access_workspace(workspace_id))
  with check (private.can_access_workspace(workspace_id));

-- No DELETE policy: permanent deletion is an Owner-only, reauthenticated,
-- explicitly confirmed destructive action handled by a server action using
-- the admin client -- never a direct client-side delete.
