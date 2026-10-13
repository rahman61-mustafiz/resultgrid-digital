-- Mark-ready (INCOMPLETE -> READY_FOR_REVIEW) now has the same staleness
-- protection as approval.
--
-- Readiness is computed in the app (src/lib/questionnaire/readiness.ts)
-- from a read of the project's answers. submit_project_for_review used to
-- take only the project id, so an answer saved between that read and this
-- call -- e.g. a concurrent save that made an answer invalid -- could still
-- end in READY_FOR_REVIEW. The app now computes readiness from
-- get_project_export_snapshot and passes that snapshot's fingerprint;
-- this function verifies it under the same client-then-project locks the
-- export RPCs use (private.lock_and_verify_export_inputs), so the status
-- only changes if the checked answers, evidence, project and client fields
-- are still exactly what the app checked. Otherwise: PT409 (HTTP 409).
--
-- The fingerprint argument is required; the old one-argument signature is
-- dropped so nothing can skip the check.

drop function public.submit_project_for_review(uuid);

create function public.submit_project_for_review(
  p_project_id uuid,
  p_expected_fingerprint text
)
returns public.project_approval_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_event public.project_approval_events;
begin
  select l.workspace_id, l.readiness_status into v_workspace_id, v_from_status
  from private.lock_and_verify_export_inputs(p_project_id, p_expected_fingerprint) l;

  if v_from_status <> 'INCOMPLETE' then
    raise exception 'project must be INCOMPLETE to submit for review (current: %)', v_from_status;
  end if;

  update public.projects
    set readiness_status = 'READY_FOR_REVIEW'
    where id = p_project_id;

  insert into public.project_approval_events (
    workspace_id, project_id, event_type, from_status, to_status, actor_id
  ) values (
    v_workspace_id, p_project_id, 'SUBMITTED_FOR_REVIEW', v_from_status, 'READY_FOR_REVIEW', auth.uid()
  )
  returning * into v_event;

  return v_event;
end;
$$;

revoke execute on function public.submit_project_for_review(uuid, text) from public, anon, service_role;
grant execute on function public.submit_project_for_review(uuid, text) to authenticated;
