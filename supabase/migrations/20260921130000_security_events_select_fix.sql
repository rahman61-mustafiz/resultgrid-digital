-- The original security_events_select_owner policy only matched rows
-- with a non-null workspace_id via private.workspace_role(workspace_id).
-- Some events genuinely can't have a workspace_id at write time (e.g. a
-- FAILED_PASSWORD_ATTEMPT logged before we know whether the attempted
-- email even belongs to a real user), which left those rows completely
-- unreadable by anyone, including the Owner -- the audit log's whole
-- purpose. Replace the policy so a null-workspace row is still visible to
-- any Owner (the MVP has exactly one workspace and one Owner). Some rows
-- also have a null user_id -- e.g. a failed password attempt for an email
-- that turned out not to belong to any account -- which is still a
-- security signal worth the Owner seeing, so this doesn't require
-- user_id = auth.uid() either.

drop policy if exists security_events_select_owner on public.security_events;

create policy security_events_select_owner
  on public.security_events
  for select
  to authenticated
  using (
    private.has_aal2()
    and (
      (workspace_id is not null and private.workspace_role(workspace_id) = 'OWNER')
      or (
        workspace_id is null
        and exists (
          select 1
          from public.workspace_members m
          where m.user_id = auth.uid()
            and m.role = 'OWNER'
        )
      )
    )
  );
