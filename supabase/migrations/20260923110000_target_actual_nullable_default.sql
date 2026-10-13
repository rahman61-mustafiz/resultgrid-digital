-- Same TypeScript-codegen fix as 20260922160000_atomic_mutation_nullable_defaults.sql:
-- p_actual has no DEFAULT, so supabase gen types generates it as
-- non-nullable `number`, which doesn't type-check against the `number |
-- null` the app needs to pass when an Owner clears a target's actual
-- value (updateActualAction). No behavior change -- every call already
-- passes this argument explicitly.

create or replace function public.update_project_target_actual(
  p_target_id uuid,
  p_project_id uuid,
  p_actual numeric default null
)
returns public.project_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_target public.project_targets;
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

  update public.project_targets
    set actual = p_actual
    where id = p_target_id and project_id = p_project_id
    returning * into v_target;

  if not found then
    raise exception 'target % not found on project %', p_target_id, p_project_id;
  end if;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Target actual value changed after approval.', auth.uid()
    );
  end if;

  return v_target;
end;
$$;
