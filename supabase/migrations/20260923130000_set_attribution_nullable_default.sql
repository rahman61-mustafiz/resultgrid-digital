-- Same TypeScript-codegen fix as 20260922160000/20260923110000:
-- p_evidence_url has no DEFAULT, so it generates as non-nullable
-- `string`, which doesn't type-check against the `string | null` the app
-- needs to pass when clearing/never-had a link. No behavior change --
-- every call already passes this argument explicitly.

create or replace function public.set_financial_record_attribution(
  p_record_id uuid,
  p_project_id uuid,
  p_evidence_status text,
  p_evidence_url text default null,
  p_attributed_to_marketing boolean default false
)
returns public.financial_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_record public.financial_records;
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

  update public.financial_records
    set evidence_status = p_evidence_status,
        evidence_url = p_evidence_url,
        attributed_to_marketing = p_attributed_to_marketing
    where id = p_record_id and project_id = p_project_id
    returning * into v_record;

  if not found then
    raise exception 'financial record % not found on project %', p_record_id, p_project_id;
  end if;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Financial record attribution/evidence changed after approval.', auth.uid()
    );
  end if;

  return v_record;
end;
$$;
