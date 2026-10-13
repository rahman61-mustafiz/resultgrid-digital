-- 20260922150000_atomic_mutation_invalidation.sql revoked direct
-- INSERT/UPDATE/DELETE on project_answers and evidence_items from
-- anon and authenticated, but missed service_role -- the same class of
-- gap 20260922140000_ledger_grants_hardening_round2.sql fixed for
-- project_approval_events/project_exports/security_events: service_role
-- bypasses RLS entirely, so it could still write these tables directly,
-- bypassing upsert_project_answer/add_evidence_item/delete_evidence_item
-- and their atomic invalidation entirely. Caught by a live grants audit
-- after the fact, the same way the readiness_status column-grant bug and
-- the original round-2 gap were.

revoke insert, update, delete on public.project_answers from service_role;
revoke insert, update, delete on public.evidence_items from service_role;
