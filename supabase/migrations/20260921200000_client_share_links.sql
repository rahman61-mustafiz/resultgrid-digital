-- Protected, read-only client share links, per
-- BUILD_READINESS_QUESTIONNAIRE.md section I: PIN-protected, expire after
-- 2 days by default, Owner can extend/revoke, project-scoped, no editing.
--
-- No RLS policy here grants the `anon` role any access -- the public
-- viewing route (src/app/share/[token]/...) looks this up with the
-- admin/service-role client, server-side, by exact token match only. That
-- keeps this table from being scannable via the anon key (a `using (true)`
-- policy would let anyone list every link's token/pin_hash, not just look
-- up the one they already have). The pin_hash is a salted hash, never the
-- raw PIN.

create table public.client_share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  token text not null unique,
  pin_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  last_accessed_at timestamptz
);

create index client_share_links_project_id_idx on public.client_share_links (project_id);

create or replace function private.set_share_link_workspace_id()
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

create trigger client_share_links_set_workspace_id
  before insert or update on public.client_share_links
  for each row
  execute function private.set_share_link_workspace_id();

alter table public.client_share_links enable row level security;

create policy client_share_links_select
  on public.client_share_links
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy client_share_links_insert
  on public.client_share_links
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy client_share_links_update
  on public.client_share_links
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));
