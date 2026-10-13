-- Target-vs-actual tracking, per BUILD_READINESS_QUESTIONNAIRE.md E14.Q10
-- and the minimum dashboard list (paying clients, leads, meetings,
-- conversion rate, acquired customers, marketing spend, CAC, revenue,
-- profit, keyword ranking). One row per metric per period, with the
-- actual value tracked directly on the row (Owner-updated) rather than a
-- separate time-series table -- simpler, at the cost of not keeping a
-- history of how the actual changed over time within one period. Revisit
-- if that history turns out to matter in practice.

create table public.project_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  metric text not null check (
    metric in (
      'PAYING_CLIENTS', 'LEADS', 'MEETINGS', 'CONVERSION_RATE',
      'ACQUIRED_CUSTOMERS', 'MARKETING_SPEND', 'CUSTOMER_ACQUISITION_COST',
      'REVENUE', 'PROFIT', 'KEYWORD_RANKING'
    )
  ),
  unit text not null,
  baseline numeric,
  target numeric not null,
  actual numeric,
  actual_source text,
  period_start date not null,
  period_end date not null,
  notes text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint project_targets_period_valid check (period_end >= period_start)
);

create index project_targets_project_id_idx on public.project_targets (project_id, period_start);

create trigger project_targets_set_updated_at
  before update on public.project_targets
  for each row
  execute function private.set_updated_at();

create or replace function private.set_project_target_workspace_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select workspace_id into new.workspace_id
  from public.projects
  where id = new.project_id;

  if new.workspace_id is null then
    raise exception 'project_id % does not reference an existing project', new.project_id;
  end if;

  return new;
end;
$$;

create trigger project_targets_set_workspace_id
  before insert or update on public.project_targets
  for each row
  execute function private.set_project_target_workspace_id();

alter table public.project_targets enable row level security;

create policy project_targets_select
  on public.project_targets
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy project_targets_insert
  on public.project_targets
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy project_targets_update
  on public.project_targets
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

create policy project_targets_delete
  on public.project_targets
  for delete
  to authenticated
  using (private.is_workspace_owner(workspace_id));
