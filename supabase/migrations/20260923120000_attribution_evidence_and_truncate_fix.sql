-- Addresses five gaps found by an independent review of the live database
-- and code after 20260923100000_attribution_and_report_periods.sql:
--
-- 1. The attribution CHECK only required evidence_status <> 'UNVERIFIED',
--    which OWNER_REPORTED satisfies with no actual evidence_url -- not
--    real evidence, just the Owner's own say-so, which is exactly what
--    the "do not claim marketing-attributed revenue without evidence"
--    rule is meant to rule out. Tightened to also require evidence_url is
--    not null.
-- 2. There was no way to add attribution/evidence to an EXISTING
--    financial_records row -- correct_financial_record only ever touches
--    amount. Added set_financial_record_attribution, matching the same
--    atomic-invalidation shape as every other mutation RPC.
-- 3. TRUNCATE was never revoked on financial_records, project_targets,
--    project_answers, evidence_items, projects, or client_businesses --
--    only the three original ledger/audit tables got that treatment in
--    20260922140000_ledger_grants_hardening_round2.sql. Closed the same
--    way: revoke the grant from anon/authenticated/service_role and add
--    a statement-level guard trigger.
--
-- (The other two findings -- the report's read-then-read race, and
-- project_targets' period filter running after a row limit that could
-- drop in-period rows -- are TypeScript-only fixes in
-- src/lib/reports/client-report.ts, not database changes.)

-- ---------------------------------------------------------------------
-- 1. Tighten the attribution constraint.
-- ---------------------------------------------------------------------

alter table public.financial_records
  drop constraint financial_records_attribution_rules;

alter table public.financial_records
  add constraint financial_records_attribution_rules
  check (
    not attributed_to_marketing
    or (
      record_type = 'CLIENT_OWN_REVENUE'
      and evidence_status <> 'UNVERIFIED'
      and evidence_url is not null
    )
  );

-- ---------------------------------------------------------------------
-- 2. Editing attribution/evidence on an existing record.
-- ---------------------------------------------------------------------

create or replace function public.set_financial_record_attribution(
  p_record_id uuid,
  p_project_id uuid,
  p_evidence_status text,
  p_evidence_url text,
  p_attributed_to_marketing boolean
)
returns public.financial_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_record public.financial_records;
begin
  select workspace_id, readiness_status into v_workspace_id, v_from_status
  from public.projects
  where id = p_project_id
  for update;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  update public.financial_records
    set evidence_status = p_evidence_status,
        evidence_url = p_evidence_url,
        attributed_to_marketing = p_attributed_to_marketing
    where id = p_record_id and project_id = p_project_id
    returning * into v_record;

  if not found then
    raise exception 'financial record % not found on project %', p_record_id, p_project_id;
  end if;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Financial record attribution/evidence changed after approval.', auth.uid()
    );
  end if;

  return v_record;
end;
$$;

revoke execute on function public.set_financial_record_attribution(uuid, uuid, text, text, boolean) from public, anon, service_role;
grant execute on function public.set_financial_record_attribution(uuid, uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. TRUNCATE lockdown, matching the round-2 ledger hardening.
-- ---------------------------------------------------------------------

revoke truncate on public.financial_records from anon, authenticated, service_role;
revoke truncate on public.project_targets from anon, authenticated, service_role;
revoke truncate on public.project_answers from anon, authenticated, service_role;
revoke truncate on public.evidence_items from anon, authenticated, service_role;
revoke truncate on public.projects from anon, authenticated, service_role;
revoke truncate on public.client_businesses from anon, authenticated, service_role;

create trigger financial_records_forbid_truncate
  before truncate on public.financial_records
  for each statement
  execute function private.forbid_mutation();

create trigger project_targets_forbid_truncate
  before truncate on public.project_targets
  for each statement
  execute function private.forbid_mutation();

create trigger project_answers_forbid_truncate
  before truncate on public.project_answers
  for each statement
  execute function private.forbid_mutation();

create trigger evidence_items_forbid_truncate
  before truncate on public.evidence_items
  for each statement
  execute function private.forbid_mutation();

create trigger projects_forbid_truncate
  before truncate on public.projects
  for each statement
  execute function private.forbid_mutation();

create trigger client_businesses_forbid_truncate
  before truncate on public.client_businesses
  for each statement
  execute function private.forbid_mutation();
