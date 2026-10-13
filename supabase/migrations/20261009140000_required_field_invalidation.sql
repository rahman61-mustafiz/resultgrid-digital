-- Spec D08 (BUILD_READINESS_QUESTIONNAIRE.md): changing a REQUIRED project
-- field, or anything in the context export, invalidates approval; notes and
-- tags do not. 20261009100000/20261009110000 invalidated only on export
-- inputs, which let a timezone edit (a required project and client field,
-- not an export input) keep the approval. Timezone now invalidates too.

create or replace function public.update_project_details(
  p_project_id uuid,
  p_project_name text,
  p_project_type text,
  p_custom_type_label text default null,
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
  v_before public.projects;
  v_client_status text;
  v_project public.projects;
begin
  v_before := private.lock_project_for_lifecycle(p_project_id);

  if v_before.lifecycle_status = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;
  select status into v_client_status from public.client_businesses where id = v_before.client_business_id;
  if v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived and read-only: restore the client first';
  end if;

  update public.projects
    set project_name = p_project_name,
        project_type = p_project_type,
        custom_type_label = p_custom_type_label,
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

  -- Required project fields and export inputs invalidate an approval
  -- (spec D08); notes, tags, description and dates don't.
  if v_before.readiness_status = 'APPROVED'
     and (v_project.project_name, v_project.project_type, v_project.custom_type_label,
          v_project.default_currency, v_project.export_language, v_project.timezone)
         is distinct from
         (v_before.project_name, v_before.project_type, v_before.custom_type_label,
          v_before.default_currency, v_before.export_language, v_before.timezone) then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    v_project.readiness_status := 'READY_FOR_REVIEW';
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_project.workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Required project details changed after approval.', auth.uid()
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
  v_before public.client_businesses;
  v_client public.client_businesses;
  r record;
begin
  select * into v_before
  from public.client_businesses
  where id = p_client_business_id
  for update;

  if v_before.id is null then
    raise exception 'client_business % not found', p_client_business_id;
  end if;

  if not private.is_workspace_owner(v_before.workspace_id) then
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

  -- Required client fields and export inputs invalidate (spec D08);
  -- notes, contact details, website and industry don't.
  if (v_client.display_name, v_client.record_type, v_client.country, v_client.timezone)
     is distinct from (v_before.display_name, v_before.record_type, v_before.country, v_before.timezone) then
    for r in
      select id from public.projects
      where client_business_id = p_client_business_id
        and readiness_status = 'APPROVED'
      order by id
      for update
    loop
      update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = r.id;
      insert into public.project_approval_events (
        workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
      ) values (
        v_before.workspace_id, r.id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
        'Required client/business details changed after approval.', auth.uid()
      );
    end loop;
  end if;

  return v_client;
end;
$$;
