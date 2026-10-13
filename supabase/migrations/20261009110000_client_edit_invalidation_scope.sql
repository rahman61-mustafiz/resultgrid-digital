-- Follow-up to 20261009100000_lifecycle_backstops.sql.
--
-- 1. update_client_business_details invalidates its projects' approvals
--    only when a client field the export is generated from changes
--    (display_name, record_type, country -- see
--    private.project_export_inputs), not for internal notes, contact
--    details, website, industry or timezone (spec D).
-- 2. An archived project is read-only, but invalidating its approval is a
--    protective system change, not an edit: projects_enforce_update now
--    lets an archived project's readiness drop APPROVED -> READY_FOR_REVIEW
--    when nothing else changes. Before this, renaming a client with an
--    archived, approved project failed outright.

create or replace function private.enforce_project_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_status text;
  v_restore_to text;
  v_event_type text;
  v_reason text;
  v_recorded boolean;
begin
  if new.client_business_id is distinct from old.client_business_id then
    raise exception 'a project cannot be moved to another client/business: archive it and create it again under the right one';
  end if;
  if old.lifecycle_status = 'ARCHIVED' and new.lifecycle_status = 'ARCHIVED' then
    if old.readiness_status = 'APPROVED' and new.readiness_status = 'READY_FOR_REVIEW'
       and (to_jsonb(new) - 'readiness_status' - 'updated_at') = (to_jsonb(old) - 'readiness_status' - 'updated_at') then
      return new;
    end if;
    raise exception 'this project is archived and read-only: restore it first';
  end if;

  if new.lifecycle_status is distinct from old.lifecycle_status then
    if old.lifecycle_status = 'ARCHIVED' then
      v_event_type := 'RESTORED';
      select coalesce(
        (select e.from_status from public.lifecycle_events e
          where e.entity_type = 'PROJECT' and e.entity_id = new.id and e.event_type = 'ARCHIVED'
          order by e.created_at desc, e.id desc limit 1),
        'ON_HOLD'
      ) into v_restore_to;
      if new.lifecycle_status is distinct from v_restore_to then
        raise exception 'a restored project returns to the status it had before archiving (%)', v_restore_to;
      end if;
    else
      if not private.project_lifecycle_transition_allowed(old.lifecycle_status, new.lifecycle_status) then
        raise exception 'a project cannot move from % to %', old.lifecycle_status, new.lifecycle_status;
      end if;
      v_event_type := case when new.lifecycle_status = 'ARCHIVED' then 'ARCHIVED' else 'LIFECYCLE_CHANGED' end;
    end if;

    select true, r.reason into v_recorded, v_reason
    from private.lifecycle_event_in_this_transaction('PROJECT', new.id, v_event_type, old.lifecycle_status, new.lifecycle_status) r;
    if v_recorded is null then
      raise exception 'project status changes only through set_project_lifecycle / restore_project, which record them';
    end if;
    if old.lifecycle_status = 'COMPLETED' and new.lifecycle_status = 'ACTIVE'
       and nullif(btrim(coalesce(v_reason, '')), '') is null then
      raise exception 'reopening a completed project requires a reason';
    end if;
  end if;

  if new.lifecycle_status <> 'ARCHIVED' then
    select status into v_client_status from public.client_businesses where id = new.client_business_id;
    if v_client_status <> 'ACTIVE' then
      raise exception 'this project''s client/business is archived and read-only: restore the client first';
    end if;
  end if;
  return new;
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

  -- Only the client fields in private.project_export_inputs invalidate.
  if (v_client.display_name, v_client.record_type, v_client.country)
     is distinct from (v_before.display_name, v_before.record_type, v_before.country) then
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
        'Client/business details used in the approved export changed after approval.', auth.uid()
      );
    end loop;
  end if;

  return v_client;
end;
$$;
