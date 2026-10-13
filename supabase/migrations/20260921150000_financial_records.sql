-- Financial/result records, per BUILD_READINESS_QUESTIONNAIRE.md section
-- M and E14. One record type per row rather than a wide table, so the
-- profit formulas (defined in application code, see
-- src/lib/finance/profit.ts) can require "at least one row of each needed
-- category exists for the period" and return INCOMPLETE otherwise --
-- never substituting a missing category with zero.
--
-- Currency is NOT stored per row: it is always the parent project's
-- default_currency (BUILD_READINESS_QUESTIONNAIRE.md B09/E14.Q06 --
-- the MVP does no currency conversion, so mixing currencies within one
-- project is a modeling error the schema shouldn't allow room for).

create table public.financial_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  record_type text not null check (
    record_type in (
      'CLIENT_PAYMENT_RECEIVED',
      'CLIENT_OWN_REVENUE',
      'MARKETING_SPEND',
      'RESULTGRID_FEE',
      'DIRECT_DELIVERY_COST',
      'ALLOCATED_OPERATING_COST',
      'OTHER_CAMPAIGN_COST'
    )
  ),
  amount numeric(14, 2) not null check (amount >= 0),
  value_status text not null default 'CONFIRMED' check (
    value_status in ('CONFIRMED', 'ESTIMATED', 'PENDING', 'REFUNDED', 'DISPUTED')
  ),

  period_start date not null,
  period_end date not null,

  evidence_status text not null default 'UNVERIFIED' check (
    evidence_status in ('VERIFIED', 'OWNER_REPORTED', 'CLIENT_REPORTED', 'UNVERIFIED')
  ),
  evidence_url text,
  notes text,

  -- Append-only correction trail: each entry is
  -- {previous_amount, reason, actor_user_id, corrected_at}. The current
  -- `amount` is always the latest value; this preserves what
  -- BUILD_READINESS_QUESTIONNAIRE.md M12/E14.Q12 requires ("corrections
  -- preserve the old value, reason, actor, and time") without a separate
  -- join table for what is expected to be an infrequent action.
  correction_history jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint financial_records_period_valid check (period_end >= period_start)
);

create index financial_records_project_id_idx on public.financial_records (project_id, period_start);
create index financial_records_workspace_id_idx on public.financial_records (workspace_id);

create trigger financial_records_set_updated_at
  before update on public.financial_records
  for each row
  execute function private.set_updated_at();

create or replace function private.set_financial_record_workspace_id()
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

create trigger financial_records_set_workspace_id
  before insert or update on public.financial_records
  for each row
  execute function private.set_financial_record_workspace_id();

alter table public.financial_records enable row level security;

create policy financial_records_select
  on public.financial_records
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy financial_records_insert
  on public.financial_records
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy financial_records_update
  on public.financial_records
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

-- No DELETE policy: financial history is corrected (see correction_history
-- above), never removed, matching M12's "corrections preserve the old
-- value" rule.
