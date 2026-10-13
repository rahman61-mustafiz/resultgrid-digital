-- Tracks devices that have completed a full (password + TOTP) sign-in, so
-- the app can tell a genuinely new device apart from a returning one and
-- log/notify per BUILD_READINESS_QUESTIONNAIRE.md C17 ("new-device login...
-- create security events and email alerts").
--
-- "Device" here is a long-lived random id stored in a signed, httpOnly
-- cookie on the browser -- not invasive fingerprinting. Managed only by
-- trusted server code via the admin client (src/lib/supabase/admin.ts);
-- there is no RLS policy granting the `authenticated` role any access.

create table public.known_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text,
  unique (user_id, device_id)
);

create index known_devices_user_id_idx on public.known_devices (user_id);

alter table public.known_devices enable row level security;
-- Intentionally no policies: RLS enabled with zero policies denies all
-- access to `anon`/`authenticated`, leaving only the service-role admin
-- client able to read or write this table.
