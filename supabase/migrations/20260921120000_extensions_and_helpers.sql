-- Extensions and base RLS helper functions shared by every later migration.
--
-- Functions that check workspace membership (private.workspace_role,
-- private.can_access_workspace) live in
-- 20260921120150_workspace_access_helpers.sql instead of here, because they
-- reference public.workspace_members -- and unlike PL/pgSQL, PostgreSQL
-- validates a LANGUAGE SQL function's body against the catalog at CREATE
-- time, so that table must already exist.

create extension if not exists pgcrypto with schema extensions;

-- Functions here live outside `public` so they are never exposed by
-- PostgREST as callable RPCs; they exist purely to back RLS policies.
create schema if not exists private;

-- True once the caller's session has reached AAL2 (i.e. completed a TOTP
-- challenge). Supabase issues this claim in the access-token JWT for MFA
-- users. Gating workspace-scoped tables on this directly in RLS enforces
-- "workspace data requires AAL2" at the database layer, not only in
-- application route guards.
create or replace function private.has_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;

grant execute on function private.has_aal2() to authenticated;

-- Reusable trigger to keep an `updated_at` column current on every UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
