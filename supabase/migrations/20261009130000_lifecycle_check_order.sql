-- Follow-up to 20261009120000_lifecycle_event_revisions.sql: projects_enforce_update
-- checks the transition matrix and restore target before the revision/event
-- requirement, so a disallowed move reports why it is disallowed rather than
-- only that it was unrecorded. Same rules, different order.

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

  if new.lifecycle_status is not distinct from old.lifecycle_status then
    if new.lifecycle_revision is distinct from old.lifecycle_revision then
      raise exception 'the lifecycle revision changes only with a recorded status change';
    end if;
  else
    if old.lifecycle_status = 'ARCHIVED' then
      v_event_type := 'RESTORED';
      v_restore_to := private.project_status_before_last_archive(new.id);
      if new.lifecycle_status is distinct from v_restore_to then
        raise exception 'a restored project returns to the status it had before archiving (%)', v_restore_to;
      end if;
    else
      if not private.project_lifecycle_transition_allowed(old.lifecycle_status, new.lifecycle_status) then
        raise exception 'a project cannot move from % to %', old.lifecycle_status, new.lifecycle_status;
      end if;
      v_event_type := case when new.lifecycle_status = 'ARCHIVED' then 'ARCHIVED' else 'LIFECYCLE_CHANGED' end;
    end if;

    if new.lifecycle_revision is distinct from old.lifecycle_revision + 1 then
      raise exception 'project status changes only through set_project_lifecycle / restore_project, which record them';
    end if;

    select true, r.reason into v_recorded, v_reason
    from private.lifecycle_transition_event(
      'PROJECT', new.id, new.lifecycle_revision, v_event_type, old.lifecycle_status, new.lifecycle_status
    ) r;
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
