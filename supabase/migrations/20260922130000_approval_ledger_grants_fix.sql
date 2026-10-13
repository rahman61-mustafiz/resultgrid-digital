-- Corrects two gaps the live acceptance run
-- (scripts/qa-approval-ledger-acceptance.mjs) actually found running
-- against the real dev project, in
-- 20260922120000_approval_ledger_hardening.sql:
--
-- 1. `revoke update (readiness_status) on public.projects from
--    authenticated` had NO effect. Postgres checks table-level and
--    column-level privileges as an OR: the `authenticated` role also
--    holds a blanket table-level UPDATE grant (from Supabase's default
--    schema privileges), and that alone permits updating any column,
--    including readiness_status, regardless of a narrower column-level
--    revoke. The acceptance run's negative test proved this by
--    successfully updating readiness_status directly with no error. The
--    actual fix is to revoke UPDATE at the table level and re-grant it
--    only for the columns the app's own update action
--    (updateProjectAction) touches, which does not include
--    readiness_status. The same OR-semantics problem applies to INSERT --
--    a direct insert could otherwise set readiness_status='APPROVED' from
--    birth with no ledger trail at all -- so INSERT gets the same
--    column-list treatment.
-- 2. project_exports had no delete-blocking trigger (only
--    forbid_update). There being no DELETE policy for `authenticated`
--    already blocks that role via RLS, but a service-role/admin caller --
--    which bypasses RLS entirely by design -- could still hard-delete
--    export history with a plain `.delete()`. project_approval_events
--    already got both triggers when it was created; give project_exports
--    the same one, matching the Do's/Don'ts: "Do not hard-delete audit,
--    approval, financial correction, or export history."

revoke update on public.projects from authenticated;
revoke insert on public.projects from authenticated;

grant insert (
  workspace_id, client_business_id, project_name, project_type,
  custom_type_label, lifecycle_status, default_currency, export_language,
  timezone, start_date, target_completion_date, short_description,
  internal_notes, tags
) on public.projects to authenticated;

grant update (
  client_business_id, project_name, project_type, custom_type_label,
  lifecycle_status, default_currency, export_language, timezone,
  start_date, target_completion_date, short_description, internal_notes,
  tags
) on public.projects to authenticated;

create trigger project_exports_forbid_delete
  before delete on public.project_exports
  for each row
  execute function private.forbid_mutation();
