-- Priority #4: report periods, attribution, and approved-snapshot
-- sharing.
--
-- 1. Attribution: computeClientProfit (src/lib/finance/profit.ts) has
--    used CLIENT_OWN_REVENUE directly as "marketing-attributed revenue"
--    since it was written, with a code comment admitting this skips
--    E14.Q09's attribution model entirely. That directly risks the
--    project's explicit Don't: "do not claim marketing-attributed revenue
--    without evidence." This adds an explicit attributed_to_marketing
--    flag, restricted by a CHECK constraint (not just app-side
--    validation) to CLIENT_OWN_REVENUE rows that also have real evidence
--    -- a record can never be marked attributed without evidence behind
--    it, enforced at the database layer.
-- 2. Approved-snapshot sharing: the client report (src/lib/reports/
--    client-report.ts), shown through PIN-protected share links, queries
--    financial_records/project_targets live -- it was never gated on
--    readiness_status, and editing those tables after approval never
--    invalidated it (unlike questionnaire answers, evidence, and project/
--    client fields, hardened in the earlier 2026-09-22 migrations). That
--    made "approved" not actually mean "the client is seeing a stable,
--    reviewed picture" for the one thing report sharing is actually
--    about: numbers. This closes that gap the same way: financial_records
--    and project_targets writes move behind SECURITY DEFINER functions
--    that invalidate an APPROVED project atomically, exactly like
--    add_evidence_item did for evidence_items.

-- ---------------------------------------------------------------------
-- 1. Attribution column + constraint.
-- ---------------------------------------------------------------------

alter table public.financial_records
  add column attributed_to_marketing boolean not null default false;

alter table public.financial_records
  add constraint financial_records_attribution_rules
  check (
    not attributed_to_marketing
    or (record_type = 'CLIENT_OWN_REVENUE' and evidence_status <> 'UNVERIFIED')
  );

-- ---------------------------------------------------------------------
-- 2. Atomic mutation+invalidation functions for financial_records and
--    project_targets, matching add_evidence_item's shape.
-- ---------------------------------------------------------------------

create or replace function public.add_financial_record(
  p_project_id uuid,
  p_record_type text,
  p_amount numeric,
  p_value_status text,
  p_period_start date,
  p_period_end date,
  p_evidence_status text default 'UNVERIFIED',
  p_evidence_url text default null,
  p_notes text default null,
  p_attributed_to_marketing boolean default false
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

  insert into public.financial_records (
    workspace_id, project_id, record_type, amount, value_status,
    period_start, period_end, evidence_status, evidence_url, notes,
    attributed_to_marketing, created_by
  ) values (
    v_workspace_id, p_project_id, p_record_type, p_amount, p_value_status,
    p_period_start, p_period_end, p_evidence_status, p_evidence_url, p_notes,
    p_attributed_to_marketing, auth.uid()
  )
  returning * into v_record;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Financial record added after approval.', auth.uid()
    );
  end if;

  return v_record;
end;
$$;

create or replace function public.bulk_add_financial_records(
  p_project_id uuid,
  p_records jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_count int := 0;
  r jsonb;
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

  for r in select * from jsonb_array_elements(p_records)
  loop
    insert into public.financial_records (
      workspace_id, project_id, record_type, amount, value_status,
      period_start, period_end, evidence_status, evidence_url, notes,
      attributed_to_marketing, created_by
    ) values (
      v_workspace_id, p_project_id,
      r->>'record_type',
      (r->>'amount')::numeric,
      r->>'value_status',
      (r->>'period_start')::date,
      (r->>'period_end')::date,
      coalesce(r->>'evidence_status', 'UNVERIFIED'),
      r->>'evidence_url',
      r->>'notes',
      coalesce((r->>'attributed_to_marketing')::boolean, false),
      auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  if v_count > 0 and v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      format('%s financial record(s) imported after approval.', v_count), auth.uid()
    );
  end if;

  return v_count;
end;
$$;

create or replace function public.correct_financial_record(
  p_record_id uuid,
  p_project_id uuid,
  p_new_amount numeric,
  p_reason text
)
returns public.financial_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_existing public.financial_records;
  v_next_history jsonb;
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

  select * into v_existing
  from public.financial_records
  where id = p_record_id and project_id = p_project_id;

  if not found then
    raise exception 'financial record % not found on project %', p_record_id, p_project_id;
  end if;

  v_next_history := coalesce(v_existing.correction_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'previous_amount', v_existing.amount,
      'reason', p_reason,
      'actor_user_id', auth.uid(),
      'corrected_at', now()
    )
  );

  update public.financial_records
    set amount = p_new_amount,
        correction_history = v_next_history
    where id = p_record_id
    returning * into v_record;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Financial record corrected after approval.', auth.uid()
    );
  end if;

  return v_record;
end;
$$;

create or replace function public.add_project_target(
  p_project_id uuid,
  p_metric text,
  p_unit text,
  p_target numeric,
  p_period_start date,
  p_period_end date,
  p_baseline numeric default null,
  p_actual numeric default null,
  p_actual_source text default null,
  p_notes text default null
)
returns public.project_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_target public.project_targets;
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

  insert into public.project_targets (
    workspace_id, project_id, metric, unit, baseline, target, actual,
    actual_source, period_start, period_end, notes, created_by
  ) values (
    v_workspace_id, p_project_id, p_metric, p_unit, p_baseline, p_target, p_actual,
    p_actual_source, p_period_start, p_period_end, p_notes, auth.uid()
  )
  returning * into v_target;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Target added after approval.', auth.uid()
    );
  end if;

  return v_target;
end;
$$;

create or replace function public.update_project_target_actual(
  p_target_id uuid,
  p_project_id uuid,
  p_actual numeric
)
returns public.project_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_target public.project_targets;
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

  update public.project_targets
    set actual = p_actual
    where id = p_target_id and project_id = p_project_id
    returning * into v_target;

  if not found then
    raise exception 'target % not found on project %', p_target_id, p_project_id;
  end if;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Target actual value changed after approval.', auth.uid()
    );
  end if;

  return v_target;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Grants + lock down the direct writes these replace, matching the
--    authenticated-only, service_role-excluded pattern from the earlier
--    ledger hardening migrations.
-- ---------------------------------------------------------------------

revoke execute on function public.add_financial_record(uuid, text, numeric, text, date, date, text, text, text, boolean) from public, anon, service_role;
revoke execute on function public.bulk_add_financial_records(uuid, jsonb) from public, anon, service_role;
revoke execute on function public.correct_financial_record(uuid, uuid, numeric, text) from public, anon, service_role;
revoke execute on function public.add_project_target(uuid, text, text, numeric, date, date, numeric, numeric, text, text) from public, anon, service_role;
revoke execute on function public.update_project_target_actual(uuid, uuid, numeric) from public, anon, service_role;

grant execute on function public.add_financial_record(uuid, text, numeric, text, date, date, text, text, text, boolean) to authenticated;
grant execute on function public.bulk_add_financial_records(uuid, jsonb) to authenticated;
grant execute on function public.correct_financial_record(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.add_project_target(uuid, text, text, numeric, date, date, numeric, numeric, text, text) to authenticated;
grant execute on function public.update_project_target_actual(uuid, uuid, numeric) to authenticated;

revoke insert, update, delete on public.financial_records from anon, authenticated, service_role;
revoke insert, update, delete on public.project_targets from anon, authenticated, service_role;
