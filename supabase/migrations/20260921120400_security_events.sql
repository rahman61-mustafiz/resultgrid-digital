-- Security/audit event log. See BUILD_READINESS_QUESTIONNAIRE.md C17 and
-- section J: new-device login, password change, TOTP change, recovery
-- request/completion, and repeated failures must be logged and must never
-- be hard-deletable through ordinary application actions.
--
-- Rows are written only by trusted server code using the admin client
-- (src/lib/supabase/admin.ts) -- there is no INSERT policy for the
-- `authenticated` role, both because some events (e.g. a failed login
-- attempt) happen before a Postgres session exists for that user, and to
-- keep the log tamper-resistant from the app's own authenticated context.
--
-- `metadata` must never contain passwords, TOTP secrets/codes, session
-- tokens, or other sensitive business data (see CLAUDE_CODE_BUILD_HANDOFF.md
-- "Security notifications must never contain secrets"). That rule is
-- enforced by the server code that writes rows here, not by the database.

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (
    event_type in (
      'NEW_DEVICE_LOGIN',
      'PASSWORD_CHANGE',
      'TOTP_ENROLLED',
      'TOTP_CHANGED',
      'RECOVERY_EMAIL_CHANGED',
      'RECOVERY_REQUESTED',
      'RECOVERY_COMPLETED',
      'FAILED_PASSWORD_ATTEMPT',
      'FAILED_TOTP_ATTEMPT',
      'ACCOUNT_LOCKED_COOLDOWN',
      'SESSION_LOCKED',
      'SESSION_UNLOCKED',
      'RECENT_REAUTH_COMPLETED'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index security_events_workspace_id_idx on public.security_events (workspace_id, created_at desc);
create index security_events_user_id_idx on public.security_events (user_id, created_at desc);

-- Block UPDATE/DELETE outright, including for the service role, so the log
-- stays append-only at the database level and not merely by convention.
-- A genuinely required correction (e.g. a legal/GDPR erasure request) must
-- go through a superuser migration, not the application.
create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'security_events rows are immutable: % is not permitted', tg_op;
end;
$$;

create trigger security_events_forbid_update
  before update on public.security_events
  for each row
  execute function private.forbid_mutation();

create trigger security_events_forbid_delete
  before delete on public.security_events
  for each row
  execute function private.forbid_mutation();

alter table public.security_events enable row level security;

-- Only the Owner can read the security log, and only at AAL2.
create policy security_events_select_owner
  on public.security_events
  for select
  to authenticated
  using (
    private.has_aal2()
    and private.workspace_role(workspace_id) = 'OWNER'
  );

-- No INSERT/UPDATE/DELETE policy for `authenticated`: see header comment.
