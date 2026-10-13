-- Rejects answers to question keys that are not part of the questionnaire.
--
-- Question definitions live in src/lib/questionnaire/v1.ts (see
-- 20260921140000_project_answers.sql for why), and the app checks the key
-- before saving -- but upsert_project_answer is callable by any signed-in
-- Owner directly through the API, and until now stored whatever key it
-- was given. This gives the database the list of valid keys per published
-- questionnaire version and checks it inside the only write path.
--
-- The list must match v1.ts exactly; e2e/unit/questionnaire.spec.ts reads
-- this file and fails if they differ. A published version is immutable
-- (BUILD_READINESS_QUESTIONNAIRE.md F10): a future v2 adds a "when 2"
-- branch rather than editing the v1 list.

create or replace function private.questionnaire_question_keys(p_version int)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_version
    when 1 then array[
      'E01.Q01', 'E01.Q02', 'E01.Q03', 'E01.Q04', 'E01.Q05', 'E01.Q06', 'E01.Q07', 'E01.Q08',
      'E01.Q09', 'E02.Q01', 'E02.Q02', 'E02.Q03', 'E02.Q04', 'E02.Q05', 'E02.Q06', 'E02.Q07',
      'E02.Q08', 'E03.Q01', 'E03.Q02', 'E03.Q03', 'E03.Q04', 'E03.Q05', 'E03.Q06', 'E03.Q07',
      'E03.Q08', 'E04.Q01', 'E04.Q02', 'E04.Q03', 'E04.Q04', 'E04.Q05', 'E04.Q06', 'E04.Q07',
      'E04.Q08', 'E04.Q09', 'E05.Q01', 'E05.Q02', 'E05.Q03', 'E05.Q04', 'E05.Q05', 'E05.Q06',
      'E05.Q07', 'E06.Q01', 'E06.Q02', 'E06.Q03', 'E06.Q04', 'E06.Q05', 'E06.Q06', 'E06.Q07',
      'E06.Q08', 'E06.Q09', 'E07.Q01', 'E07.Q02', 'E07.Q03', 'E07.Q04', 'E07.Q05', 'E07.Q06',
      'E07.Q07', 'E07.Q08', 'E07.Q09', 'E08.Q01', 'E08.Q02', 'E08.Q03', 'E08.Q04', 'E08.Q05',
      'E08.Q06', 'E08.Q07', 'E08.Q08', 'E09.Q01', 'E09.Q02', 'E09.Q03', 'E09.Q04', 'E09.Q05',
      'E09.Q06', 'E09.Q07', 'E09.Q08', 'E09.Q09', 'E09.Q10', 'E10.Q01', 'E10.Q02', 'E10.Q03',
      'E10.Q04', 'E10.Q05', 'E10.Q06', 'E10.Q07', 'E10.Q08', 'E10.Q09', 'E10.Q10', 'E11.Q01',
      'E11.Q02', 'E11.Q03', 'E11.Q04', 'E11.Q05', 'E11.Q06', 'E11.Q07', 'E11.Q08', 'E11.Q09',
      'E12.Q01', 'E12.Q02', 'E12.Q03', 'E12.Q04', 'E12.Q05', 'E12.Q06', 'E12.Q07', 'E12.Q08',
      'E12.Q09', 'E13.Q01', 'E13.Q02', 'E13.Q03', 'E13.Q04', 'E13.Q05', 'E13.Q06', 'E13.Q07',
      'E13.Q08', 'E13.Q09', 'E13.Q10', 'E14.Q01', 'E14.Q02', 'E14.Q03', 'E14.Q04', 'E14.Q05',
      'E14.Q06', 'E14.Q07', 'E14.Q08', 'E14.Q09', 'E14.Q10', 'E14.Q11', 'E14.Q12', 'E14.Q13',
      'E14.Q14', 'E14.Q15'
    ]::text[]
    else array[]::text[]
  end
$$;

revoke execute on function private.questionnaire_question_keys(int) from public, anon, authenticated, service_role;

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
  if not (p_question_key = any (private.questionnaire_question_keys(p_questionnaire_version))) then
    raise exception 'unknown question % for questionnaire version %', p_question_key, p_questionnaire_version
      using errcode = '22023';
  end if;

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
