-- Single-statement read for the client report (src/lib/reports/client-report.ts).
--
-- buildClientReport used to read project status, financial_records and
-- project_targets as separate PostgREST requests. Under READ COMMITTED each
-- request gets its own snapshot, so an edit plus a full re-approval landing
-- between those requests could produce a report mixing rows from before the
-- edit with an APPROVED status from after it. Reading the status last only
-- narrowed that window.
--
-- This function returns everything the report needs from ONE SELECT. A
-- statement sees one snapshot for its whole duration (a STABLE SQL function
-- runs under the calling statement's snapshot), so status, export version,
-- financials and targets always come from the same point in time.
--
-- Called only by the server with the service-role client (the public share
-- page has no user session), so EXECUTE is granted to service_role only.

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
