-- Same class of gap as 20260922170000_atomic_mutation_service_role_fix.sql,
-- found by extending that grants audit to every table touched by the
-- atomic-mutation migrations: 20260922130000_approval_ledger_grants_fix.sql
-- and 20260922150000_atomic_mutation_invalidation.sql revoked direct
-- INSERT/UPDATE on `projects` and `client_businesses` from anon and
-- authenticated (moving those writes behind update_project_details /
-- update_client_business_details), but never touched service_role -- which
-- bypasses RLS entirely and, unlike anon/authenticated, was never blocked
-- by the absence of a matching policy. service_role therefore still held
-- its original blanket table-level INSERT/UPDATE on both tables,
-- including projects.readiness_status: a service-role caller could still
-- set a project APPROVED directly, with zero ledger trail, bypassing
-- every RPC built in the last several migrations.
--
-- Nothing in this app's server code uses the admin (service-role) client
-- to write to projects or client_businesses -- every create/update path
-- goes through the user's own authenticated session (createProjectAction,
-- createClientBusinessAction, and the RPCs). So unlike project_answers/
-- evidence_items (which needed a narrower fix, see the previous
-- migration) or client_businesses' status/archived_at columns (still
-- needed directly by archive/restore), service_role needs no INSERT or
-- UPDATE access to either table at all.

revoke insert, update on public.projects from service_role;
revoke insert, update on public.client_businesses from service_role;
