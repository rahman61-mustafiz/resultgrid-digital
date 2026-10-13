-- One-time backfill: the rows written before the workspace_id fix in
-- src/lib/auth/security-log.ts (this session's own local testing) have
-- workspace_id = null even though the acting user_id is known and that
-- user does belong to a workspace. This is exactly the "genuinely
-- required correction" the security_events_forbid_update trigger's
-- comment anticipates: it must go through a superuser migration, so the
-- trigger is disabled for the duration of this single statement only.

alter table public.security_events disable trigger security_events_forbid_update;

update public.security_events se
set workspace_id = m.workspace_id
from public.workspace_members m
where se.workspace_id is null
  and se.user_id is not null
  and se.user_id = m.user_id;

alter table public.security_events enable trigger security_events_forbid_update;
