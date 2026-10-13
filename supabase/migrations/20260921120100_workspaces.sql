-- Workspace and membership tables.
--
-- The MVP uses exactly one workspace owned by the single pre-authorized
-- Owner account (see BUILD_READINESS_QUESTIONNAIRE.md B01/C02). That
-- workspace and its Owner membership row are created by a trusted seed
-- script running with the service-role key, not through end-user-facing
-- RLS-gated inserts -- there is no "create workspace" UI in the MVP.
--
-- The four workspace roles (Owner, Editor, Viewer, Client Read-only) are
-- part of the confirmed data model (see MARKETING_OS_FOUNDATION_BRIEF.md
-- "Roles and permissions"), so the schema accepts all four values now.
-- Only Owner has active behavior in the MVP (C05-C11); Editor/Viewer/
-- Client Read-only require a fresh, separate confirmation before any
-- policy grants them behavior.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_timezone text not null default 'Asia/Dhaka',
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('OWNER', 'EDITOR', 'VIEWER', 'CLIENT_READONLY')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- The workspaces_select_member policy (using private.can_access_workspace)
-- is created in 20260921120150_workspace_access_helpers.sql, once that
-- function exists -- it depends on this migration's tables.

-- A member can see their own membership row(s). This intentionally does
-- not let a member enumerate other members -- there is no confirmed
-- product need for that in the MVP, and workspace_role() already runs as
-- security definer so it doesn't depend on this policy.
create policy workspace_members_select_self
  on public.workspace_members
  for select
  to authenticated
  using (private.has_aal2() and user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: workspace and membership rows are
-- managed only by the service-role seed/admin path, never directly by an
-- authenticated user's own session.
