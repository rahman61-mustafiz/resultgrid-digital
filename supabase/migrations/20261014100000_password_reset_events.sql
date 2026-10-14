-- Forgot-password flow (Rana, 14 October 2026): two new audit events.
--   PASSWORD_RESET_REQUESTED -- someone asked for a reset link (logged
--                               whether or not the email has an account)
--   PASSWORD_RESET_COMPLETED -- a new password was set through the link,
--                               after the TOTP challenge
-- The table stays append-only; only the allowed event types change.

alter table public.security_events drop constraint security_events_event_type_check;

alter table public.security_events add constraint security_events_event_type_check check (
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
    'RECENT_REAUTH_COMPLETED',
    'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_COMPLETED'
  )
);
