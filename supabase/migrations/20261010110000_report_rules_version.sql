-- Priority #10 review: the client report used different period rules from
-- the dashboard (server-local dates; a record overlapping the period
-- counted in full) and had no weekly period (BUILD_READINESS_QUESTIONNAIRE.md
-- M07, acceptance: "weekly and monthly reports").
--
-- Report calculation rules are now versioned per share link, so a link a
-- client already has never changes its numbers silently:
--   v1 (links created before this migration): the original rules.
--   v2 (new links, and the Owner's preview): dates in the project's
--       timezone; a record counts only when its dates fall inside the
--       period (one that straddles the edge is left out and noted); weekly
--       and quarterly periods.
-- The report states which rules it uses.
--
-- The snapshot now carries the project's timezone (a timezone change
-- already invalidates approval, 20261009140000).

begin;

alter table public.client_share_links
  add column report_rules_version smallint not null default 1
    check (report_rules_version in (1, 2));
alter table public.client_share_links alter column report_rules_version set default 2;

create or replace function public.get_client_report_snapshot(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'project_name', p.project_name,
    'default_currency', p.default_currency,
    'timezone', p.timezone,
    'readiness_status', p.readiness_status,
    'client_name', cb.display_name,
    'latest_export_version', (
      select max(e.version) from public.project_exports e where e.project_id = p.id
    ),
    'financials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'record_type', f.record_type,
        'amount', f.amount,
        'value_status', f.value_status,
        'attributed_to_marketing', f.attributed_to_marketing,
        'period_start', f.period_start,
        'period_end', f.period_end
      ) order by f.period_start, f.id)
      from public.financial_records f
      where f.project_id = p.id
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'metric', t.metric,
        'unit', t.unit,
        'target', t.target,
        'actual', t.actual,
        'period_start', t.period_start,
        'period_end', t.period_end
      ) order by t.period_start desc, t.id)
      from public.project_targets t
      where t.project_id = p.id
    ), '[]'::jsonb)
  )
  from public.projects p
  left join public.client_businesses cb on cb.id = p.client_business_id
  where p.id = p_project_id
$$;

revoke execute on function public.get_client_report_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_client_report_snapshot(uuid) to service_role;

commit;
