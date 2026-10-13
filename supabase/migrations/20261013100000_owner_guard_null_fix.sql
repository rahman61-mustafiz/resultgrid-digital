-- SECURITY FIX, found by scripts/qa-rpc-authorization.mjs (Priority #12).
--
-- private.is_workspace_owner() returned NULL, not false, for a signed-in
-- aal2 caller with no membership in the workspace:
--   has_aal2() (true) AND workspace_role(...) = 'OWNER' (NULL = 'OWNER' -> NULL)
-- Every RPC guards with `if not private.is_workspace_owner(...) then raise`,
-- and `not NULL` is NULL, which IF treats as false -- so the refusal was
-- skipped and a non-member account that had completed TOTP could call the
-- Owner-only RPCs. (RLS policies were not affected: a NULL USING result hides
-- the row. An Owner without TOTP was refused, since false AND x is false.
-- Signup is disabled, so only accounts created by the Owner/admin could
-- reach this.)
--
-- The function now always returns true or false. The lifecycle transition
-- check gets the same treatment so a NULL status can never pass it.

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.has_aal2() and private.workspace_role(target_workspace_id) = 'OWNER',
    false
  );
$$;

create or replace function private.project_lifecycle_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_from, p_to) in (
    ('ACTIVE', 'ON_HOLD'), ('ACTIVE', 'COMPLETED'), ('ACTIVE', 'ARCHIVED'),
    ('ON_HOLD', 'ACTIVE'), ('ON_HOLD', 'COMPLETED'), ('ON_HOLD', 'ARCHIVED'),
    ('COMPLETED', 'ACTIVE'), ('COMPLETED', 'ARCHIVED')
  ), false)
$$;
