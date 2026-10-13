-- Manual, one-time (or occasional) purge of QA acceptance fixtures left
-- behind by scripts/qa-approval-ledger-acceptance.mjs and
-- scripts/qa-vera-wellness-e2e.mjs.
--
-- WHY THIS EXISTS AS A SEPARATE, MANUAL SCRIPT: project_approval_events
-- and project_exports are deliberately immutable (see
-- 20260922110000_project_approval_events.sql,
-- 20260922120000_approval_ledger_hardening.sql,
-- 20260922140000_ledger_grants_hardening_round2.sql) -- DELETE is blocked
-- by both a revoked grant and a BEFORE DELETE trigger, for every role,
-- including service_role. That is correct and load-bearing for real
-- approval/export history, and it means the acceptance script's test
-- projects can NEVER be cleanly cascade-deleted while those triggers are
-- active -- there is no such thing as a fully self-cleaning run against a
-- shared project. This script is the deliberate, scoped exception: run it
-- by hand, only against a project you know only has QA fixture data
-- matching the filter below, never automatically.
--
-- Usage:
--   npx supabase db query --linked -f scripts/qa-purge-fixtures.sql
--
-- Scope: only rows reachable from a client_businesses row whose
-- display_name starts with 'QA Ledger Acceptance ' or 'Vera Wellness QA '
-- -- the exact tags those two scripts always use (see `runId` in each).
-- Review the SELECT below before running the DELETE further down.

select id, display_name, created_at
from public.client_businesses
where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %'
order by created_at;

begin;

-- Every user trigger (append-only guards, delete backstops, retention
-- guards) is off for these tables inside this one transaction only;
-- foreign-key cascades are system triggers and still run. Evidence FILES
-- in Storage (evidence rows, uploads, queued deletions) are not removed by
-- SQL: delete them with the Storage API (scripts/lib/qa-fixtures.mjs
-- purgeQaClients does).
alter table public.client_businesses disable trigger user;
alter table public.projects disable trigger user;
alter table public.project_answers disable trigger user;
alter table public.evidence_items disable trigger user;
alter table public.financial_records disable trigger user;
alter table public.project_targets disable trigger user;
alter table public.creatives disable trigger user;
alter table public.client_share_links disable trigger user;
alter table public.project_exports disable trigger user;
alter table public.project_approval_events disable trigger user;
alter table public.lifecycle_events disable trigger user;
alter table public.creative_approval_history disable trigger user;
alter table public.project_export_evidence disable trigger user;
alter table public.project_export_archive_events disable trigger user;
alter table public.evidence_uploads disable trigger user;

with qa_clients as (
  select id from public.client_businesses
  where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %'
)
delete from public.creative_approval_history
where project_id in (select id from public.projects where client_business_id in (select id from qa_clients));

with qa_clients as (
  select id from public.client_businesses
  where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %'
)
delete from public.lifecycle_events
where entity_id in (select id from qa_clients)
   or entity_id in (select id from public.projects where client_business_id in (select id from qa_clients));

with qa_clients as (
  select id from public.client_businesses
  where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %'
)
delete from public.storage_cleanup_queue
where project_id in (select id from public.projects where client_business_id in (select id from qa_clients));

with qa_clients as (
  select id from public.client_businesses
  where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %'
)
delete from public.projects
where client_business_id in (select id from qa_clients);

delete from public.client_businesses
where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %';

alter table public.client_businesses enable trigger user;
alter table public.projects enable trigger user;
alter table public.project_answers enable trigger user;
alter table public.evidence_items enable trigger user;
alter table public.financial_records enable trigger user;
alter table public.project_targets enable trigger user;
alter table public.creatives enable trigger user;
alter table public.client_share_links enable trigger user;
alter table public.project_exports enable trigger user;
alter table public.project_approval_events enable trigger user;
alter table public.lifecycle_events enable trigger user;
alter table public.creative_approval_history enable trigger user;
alter table public.project_export_evidence enable trigger user;
alter table public.project_export_archive_events enable trigger user;
alter table public.evidence_uploads enable trigger user;

commit;

-- Verify: should return zero rows.
select id, display_name from public.client_businesses
where display_name like 'QA Ledger Acceptance %' or display_name like 'Vera Wellness QA %' or display_name like 'QA Lifecycle %' or display_name like 'QA Evidence %';
