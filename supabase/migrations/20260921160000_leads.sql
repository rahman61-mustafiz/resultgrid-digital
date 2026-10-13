-- Leads, per BUILD_READINESS_QUESTIONNAIRE.md section (Leads and follow-up)
-- and CLAUDE_CODE_BUILD_HANDOFF.md "Leads and follow-up". Scoped at the
-- workspace level, not a project -- a lead is a prospective inquiry that
-- predates any project existing.
--
-- normalized_phone/normalized_email back the duplicate check: "if either
-- normalized phone or normalized email matches, show a possible-duplicate
-- review rather than automatically creating or merging a record." The
-- app computes the normalized values (see src/lib/domain/lead.ts) and
-- writes them alongside the raw ones; normalization logic living in
-- application code, not a DB function, keeps it easy to test and evolve.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  name text not null check (char_length(btrim(name)) > 0),
  business_name text,
  phone text,
  normalized_phone text,
  email text,
  normalized_email text,
  service_needed text,
  budget text,
  consent boolean not null default false,

  stage text not null default 'NEW' check (
    stage in ('NEW', 'QUALIFIED', 'MEETING_BOOKED', 'QUOTE_SENT', 'PAYING_CLIENT', 'LOST')
  ),
  -- Required when Rana moves a lead to QUALIFIED or LOST -- enforced in
  -- application logic (depends on the transition, not just the final
  -- value, which a CHECK constraint can't express).
  qualification_reason text,
  source text,

  followup_count int not null default 0,
  last_followup_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index leads_workspace_id_idx on public.leads (workspace_id, stage);
create index leads_normalized_phone_idx on public.leads (workspace_id, normalized_phone) where normalized_phone is not null;
create index leads_normalized_email_idx on public.leads (workspace_id, normalized_email) where normalized_email is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function private.set_updated_at();

alter table public.leads enable row level security;

create policy leads_select
  on public.leads
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy leads_insert
  on public.leads
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy leads_update
  on public.leads
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

-- No DELETE policy: leads are a sales/attribution record; Owner-only
-- permanent deletion (if ever needed) goes through the admin client, not
-- ordinary RLS-gated access, matching client_businesses/projects.
