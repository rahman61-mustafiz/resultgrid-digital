-- Second hardening pass on the approval ledger, from an external review of
-- live grants (not caught by the acceptance script, which authenticates
-- as an ordinary workspace Owner and so never exercised service_role or
-- PUBLIC-level access):
--
-- 1. Supabase's default schema privileges (`grant all on all tables in
--    schema public to postgres, anon, authenticated, service_role`, set up
--    once for the whole public schema) gave INSERT/UPDATE/DELETE/TRUNCATE
--    on project_approval_events and project_exports to service_role too,
--    not just anon/authenticated. RLS does not apply to service_role at
--    all (it bypasses RLS by design), so "no INSERT policy" only ever
--    stopped anon/authenticated -- a service-role caller (or anything
--    that obtains that key) could still write arbitrary ledger rows or
--    export content directly, bypassing every RPC's authorization,
--    compare-and-swap, and atomicity guarantee. The RPC functions are
--    unaffected by these revokes: as SECURITY DEFINER functions they
--    execute as their owner (the migration-applying role), not as the
--    caller's role, exactly like the private.* RLS helper functions.
-- 2. TRUNCATE does not fire row-level BEFORE/AFTER triggers (only
--    statement-level ones registered specifically FOR EACH STATEMENT on
--    the TRUNCATE event), so the existing forbid_update/forbid_delete
--    triggers on project_approval_events/project_exports never covered
--    it -- any role that still held TRUNCATE could wipe the entire table
--    in one statement. Revoking the TRUNCATE privilege is the primary
--    fix; a statement-level trigger is added as well so the guarantee
--    doesn't depend solely on grants staying correct forever.
-- 3. All 5 ledger RPC functions were created with PostgreSQL's default
--    behavior of also granting EXECUTE to PUBLIC (which anon inherits),
--    flagged by Supabase's security advisor. Their internal
--    private.is_workspace_owner() check already stops an anonymous caller
--    from *doing* anything, but "callable by anyone, denied internally"
--    is strictly worse than "not callable at all" -- revoke from PUBLIC
--    explicitly rather than relying on every function body staying
--    correct forever.
--
-- security_events (the account/session audit log, not part of this
-- ledger) gets the same UPDATE/DELETE/TRUNCATE lockdown for the same
-- "never hard-delete audit history" reason, but keeps service_role INSERT
-- -- src/lib/auth/security-log.ts legitimately writes to it via the admin
-- client, there being no per-project RPC layer for account-level events.

-- ---------------------------------------------------------------------
-- 1 & 2. Table grants + TRUNCATE triggers.
-- ---------------------------------------------------------------------

revoke insert, update, delete, truncate on public.project_approval_events
  from anon, authenticated, service_role;

revoke insert, update, delete, truncate on public.project_exports
  from anon, authenticated, service_role;

revoke insert, update, delete, truncate on public.security_events
  from anon, authenticated, service_role;
grant insert on public.security_events to service_role;

create trigger project_approval_events_forbid_truncate
  before truncate on public.project_approval_events
  for each statement
  execute function private.forbid_mutation();

create trigger project_exports_forbid_truncate
  before truncate on public.project_exports
  for each statement
  execute function private.forbid_mutation();

create trigger security_events_forbid_truncate
  before truncate on public.security_events
  for each statement
  execute function private.forbid_mutation();

-- ---------------------------------------------------------------------
-- 3. Function EXECUTE privileges.
-- ---------------------------------------------------------------------

revoke execute on function public.submit_project_for_review(uuid) from public, anon;
revoke execute on function public.approve_and_export_project(uuid, text, text, text, int, text) from public, anon;
revoke execute on function public.record_project_export(uuid, text, text, text, int) from public, anon;
revoke execute on function public.invalidate_project_approval(uuid, text, text) from public, anon;
revoke execute on function public.invalidate_client_approvals(uuid, text) from public, anon;

-- Each already has `grant execute ... to authenticated` from
-- 20260922120000_approval_ledger_hardening.sql; re-asserted here so this
-- migration is a complete, correct statement of the intended grants on
-- its own, not just a diff against the previous one.
grant execute on function public.submit_project_for_review(uuid) to authenticated;
grant execute on function public.approve_and_export_project(uuid, text, text, text, int, text) to authenticated;
grant execute on function public.record_project_export(uuid, text, text, text, int) to authenticated;
grant execute on function public.invalidate_project_approval(uuid, text, text) to authenticated;
grant execute on function public.invalidate_client_approvals(uuid, text) to authenticated;
