-- Adds `default null` to the optional text/date/jsonb parameters of the
-- five functions from 20260922150000_atomic_mutation_invalidation.sql.
-- Purely a TypeScript-codegen concern, no behavior change: Postgres
-- function parameters accept NULL at call time regardless of a declared
-- default, but `supabase gen types typescript` only marks a parameter
-- optional (and nullable) in the generated Args type when it has a
-- DEFAULT -- without one, every nullable column (custom_type_label,
-- short_description, evidence_date, ...) generated as non-nullable
-- `string`/`string[]`, which doesn't type-check against the `string |
-- null` values the app legitimately needs to pass for an empty optional
-- field. CREATE OR REPLACE FUNCTION can add a default to an existing
-- parameter without changing its position, name, or type, so this is
-- additive -- every existing call (which always passes these arguments
-- explicitly, never omits them) behaves identically.

create or replace function public.upsert_project_answer(
  p_project_id uuid,
  p_question_key text,
  p_questionnaire_version int,
  p_status text,
  p_value jsonb default null,
  p_next_readiness_status text default 'READY_FOR_REVIEW'
)
returns public.project_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_answer public.project_answers;
begin
  if p_next_readiness_status not in ('INCOMPLETE', 'READY_FOR_REVIEW') then
    raise exception 'invalid next_readiness_status %', p_next_readiness_status;
  end if;

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

  insert into public.project_answers (
    workspace_id, project_id, question_key, questionnaire_version, status, value, updated_by
  ) values (
    v_workspace_id, p_project_id, p_question_key, p_questionnaire_version, p_status, p_value, auth.uid()
  )
  on conflict (project_id, question_key) do update
    set status = excluded.status,
        value = excluded.value,
        questionnaire_version = excluded.questionnaire_version,
        updated_by = excluded.updated_by
  returning * into v_answer;

  if v_from_status <> 'INCOMPLETE' and v_from_status <> p_next_readiness_status then
    update public.projects
      set readiness_status = p_next_readiness_status
      where id = p_project_id;

    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', v_from_status, p_next_readiness_status,
      'Questionnaire answer changed after approval/review.', auth.uid()
    );
  end if;

  return v_answer;
end;
$$;

create or replace function public.add_evidence_item(
  p_project_id uuid,
  p_category text,
  p_original_filename text default null,
  p_external_url text default null,
  p_verification_status text default null,
  p_evidence_date date default null,
  p_notes text default null
)
returns public.evidence_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_item public.evidence_items;
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

  insert into public.evidence_items (
    workspace_id, project_id, category, original_filename, external_url,
    verification_status, evidence_date, notes, created_by
  ) values (
    v_workspace_id, p_project_id, p_category, p_original_filename, p_external_url,
    p_verification_status, p_evidence_date, p_notes, auth.uid()
  )
  returning * into v_item;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Evidence item added after approval.', auth.uid()
    );
  end if;

  return v_item;
end;
$$;

create or replace function public.update_project_details(
  p_project_id uuid,
  p_client_business_id uuid,
  p_project_name text,
  p_project_type text,
  p_custom_type_label text default null,
  p_lifecycle_status text default 'ACTIVE',
  p_default_currency text default null,
  p_export_language text default 'en',
  p_timezone text default null,
  p_start_date date default null,
  p_target_completion_date date default null,
  p_short_description text default null,
  p_internal_notes text default null,
  p_tags text[] default '{}'
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_project public.projects;
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

  update public.projects
    set client_business_id = p_client_business_id,
        project_name = p_project_name,
        project_type = p_project_type,
        custom_type_label = p_custom_type_label,
        lifecycle_status = p_lifecycle_status,
        default_currency = p_default_currency,
        export_language = p_export_language,
        timezone = p_timezone,
        start_date = p_start_date,
        target_completion_date = p_target_completion_date,
        short_description = p_short_description,
        internal_notes = p_internal_notes,
        tags = p_tags
    where id = p_project_id
    returning * into v_project;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    v_project.readiness_status := 'READY_FOR_REVIEW';
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Project details changed after approval.', auth.uid()
    );
  end if;

  return v_project;
end;
$$;

create or replace function public.update_client_business_details(
  p_client_business_id uuid,
  p_display_name text,
  p_record_type text,
  p_country text default null,
  p_timezone text default null,
  p_legal_name text default null,
  p_website text default null,
  p_industry text default null,
  p_primary_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_internal_notes text default null
)
returns public.client_businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_client public.client_businesses;
  r record;
begin
  select workspace_id into v_workspace_id
  from public.client_businesses
  where id = p_client_business_id
  for update;

  if v_workspace_id is null then
    raise exception 'client_business % not found', p_client_business_id;
  end if;

  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  update public.client_businesses
    set display_name = p_display_name,
        record_type = p_record_type,
        country = p_country,
        timezone = p_timezone,
        legal_name = p_legal_name,
        website = p_website,
        industry = p_industry,
        primary_contact_name = p_primary_contact_name,
        email = p_email,
        phone = p_phone,
        address = p_address,
        internal_notes = p_internal_notes
    where id = p_client_business_id
    returning * into v_client;

  for r in
    select id from public.projects
    where client_business_id = p_client_business_id
      and readiness_status = 'APPROVED'
    for update
  loop
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = r.id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, r.id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Client/business details changed after approval.', auth.uid()
    );
  end loop;

  return v_client;
end;
$$;
