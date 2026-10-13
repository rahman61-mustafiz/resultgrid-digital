-- Questionnaire answers. Question DEFINITIONS (wording, type, required/
-- conditional rules, validation, evidence requirement, sensitivity, export
-- destination) live in versioned code at src/lib/questionnaire/, not in
-- the database -- they are content/config with the same "immutable once
-- published" requirement as a migration file already gives us for free,
-- and don't need transactional storage. Only the per-project ANSWER data
-- is stored here.

create table public.project_answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  questionnaire_version int not null default 1,
  question_key text not null,
  status text not null default 'UNANSWERED' check (
    status in ('UNANSWERED', 'ANSWERED', 'CONFIRMED', 'NOT_STARTED', 'NOT_APPLICABLE', 'UNKNOWN')
  ),
  value jsonb,
  evidence_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  unique (project_id, question_key)
);

create index project_answers_project_id_idx on public.project_answers (project_id);
create index project_answers_workspace_id_idx on public.project_answers (workspace_id);

-- workspace_id is always derived from the parent project, never trusted
-- from the client, so a caller can't point an answer row at a different
-- workspace than its project actually belongs to.
create or replace function private.set_project_answer_workspace_id()
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

  new.updated_at = now();
  return new;
end;
$$;

create trigger project_answers_set_workspace_id
  before insert or update on public.project_answers
  for each row
  execute function private.set_project_answer_workspace_id();

alter table public.project_answers enable row level security;

create policy project_answers_select
  on public.project_answers
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

create policy project_answers_insert
  on public.project_answers
  for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy project_answers_update
  on public.project_answers
  for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));
