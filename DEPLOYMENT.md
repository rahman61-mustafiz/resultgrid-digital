# Deployment preparation

This documents what production deployment requires. **Nothing here has
been deployed** -- per `CLAUDE_CODE_BUILD_HANDOFF.md`, production
deployment needs Rana's separate, explicit authorization.

## Current state

- Development Supabase project: `resultgrid-digital` (ref
  `nplhkznhffvezoflrpza`), region `ap-northeast-1`, in the account's
  personal organization. All migrations applied; contains only synthetic/
  test data.
- No Vercel project exists yet.
- No production Supabase project exists yet.

## Before deploying, in order

1. **Create a separate production Supabase project.** Development and
   production must not share a database, storage, or Auth configuration
   (`BUILD_READINESS_QUESTIONNAIRE.md` K04). Select the nearest suitable
   region and record it (K07/J07) -- don't assume one.
2. **Apply all migrations** to the production project:
   `npx supabase link --project-ref <prod-ref>` then
   `npx supabase db push`.
   - **Verify auth settings after any push that touches `[auth]`** in
     `supabase/config.toml` -- `supabase config push` has shown
     confusing side effects on this project (it silently disabled MFA
     and the entire email provider once). Confirm with a real signup
     attempt (`expect signup_disabled`) and a real login, not just the
     push command's own diff output.
   - Confirm `auth.enable_signup = false` and
     `auth.mfa.totp.enroll_enabled/verify_enabled = true` are actually
     live via the Management API or dashboard, not just the config file.
3. **Run the bootstrap script** against production:
   `node --env-file=.env.production.local scripts/bootstrap-workspace.mjs`
   -- creates the Owner auth user, workspace, and membership. Choose a
   strong password at the prompt (never pass it as a CLI argument).
4. **Set environment variables** in the Vercel project (see
   `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (mark
   sensitive), `APP_URL` (the real production URL, no trailing slash),
   `OWNER_EMAIL`, `RECOVERY_EMAIL`, `CRON_SECRET` (at least 32
   characters, mark sensitive; the daily storage cleanup in `vercel.json`
   refuses to run without it).
5. **Set `site_url` and the recovery redirect** in the production
   project's auth config to the real `APP_URL` -- the recovery flow
   (`/recovery/callback`) and any Supabase-generated links depend on this
   matching exactly.
6. **Sign in once and complete TOTP enrollment** on production before
   telling anyone else the URL exists -- there is no way to reach
   workspace data without it, by design.
7. **Confirm the domain, DNS, and business email configuration**
   separately -- this app does not manage `resultgriddigital.com` DNS or
   the business email account; those stay under Rana's direct control per
   the handoff's stated boundaries.
8. **Run the approval ledger acceptance script** against the target
   project before trusting it with real approvals:
   `node --env-file=.env.production.local scripts/qa-approval-ledger-acceptance.mjs`.
   It creates a temporary workspace member, client, and project; exercises
   every RPC (including forced-failure atomicity checks -- a rejected
   write must leave neither the data nor the readiness status changed);
   and fails loudly (non-zero exit) if any check or cleanup step doesn't
   hold on that project -- confirming the migrations actually took effect
   there, not just on dev. It checks specific PostgreSQL SQLSTATE codes on
   its negative tests (not "any error"), covering both the `authenticated`
   role and, separately, `service_role` (which bypasses RLS and needs its
   own grant-level checks) and anonymous access to the RPC functions.
   - **It does not fully clean up after itself, by design.**
     `project_approval_events`/`project_exports` are immutable, so the
     project/client/ledger/export rows it creates cannot be deleted once
     created (the same guarantee that protects real approval history).
     The script only removes what's safely removable (the temporary auth
     user, its MFA factor, its workspace membership) and validates each
     removal rather than assuming success. Run
     `node --env-file=... scripts/qa-purge-fixtures.sql`'s SQL via
     `npx supabase db query --linked -f scripts/qa-purge-fixtures.sql` to
     periodically purge accumulated QA fixtures from a shared project (it
     deliberately, temporarily disables the immutability triggers -- read
     it before running), or point the script at a disposable database
     (`supabase start` + `supabase db reset`) if a fully self-cleaning run
     matters more than testing against the real target project.
   - **Auth-user hard delete has occasionally failed** on this project
     with a generic "Database error deleting user" from Supabase's Auth
     service, even after removing the user's MFA factor first, for
     reasons that don't trace back to anything in this app's schema (every
     foreign key to `auth.users` is `ON DELETE SET NULL`/`CASCADE`, and
     freshly created users usually delete cleanly). The script falls back
     to a soft delete in that case (credentials anonymized, sign-in
     permanently disabled, row not removed) and reports it as a cleanup
     failure rather than silently succeeding -- if that happens, remove
     the listed user ID manually via the Supabase dashboard.
   - TRUNCATE privilege on the ledger/export/audit tables isn't reachable
     through the app's API (PostgREST has no TRUNCATE operation) so isn't
     covered by this script -- confirm it manually once per target
     project: `npx supabase db query --linked "select grantee,
     privilege_type from information_schema.table_privileges where
     table_name in ('project_approval_events','project_exports',
     'security_events') and privilege_type = 'TRUNCATE'"` must return zero
     rows for anon/authenticated/service_role.

## Email (SMTP)

The dev project sends through the business mailbox (Hostinger): host
`smtp.hostinger.com`, port 465, user `mustafiz@resultgriddigital.com`,
sender name "ResultGrid Digital". Rana entered the password in the
dashboard (Authentication -> Emails -> SMTP Settings); it is never kept in
a file or chat.

**Verified on 13 October 2026:** a password-reset email sent through the
dev project's Auth API (`resetPasswordForEmail`, the call the recovery flow
makes) at 05:45 UTC reached the mailbox (Rana confirmed it arrived). The
sender address shown wasn't separately confirmed, and the full recovery
flow (`/recovery` -> emailed link -> `/recovery/callback`) wasn't run.

The production project needs the same SMTP setup, separately, and the same
check.

## Backups

- **Daily:** Supabase's managed backups (production, once created).
- **Weekly downloadable backup (J04):**
  `node --env-file=<env file> scripts/backup-database.mjs` with Docker
  running. It refuses if the linked project isn't the one in the env file.
  Writes `backups/<timestamp>/`: `roles.sql`, `schema.sql`,
  `data.sql`, every Storage object, and `manifest.json` (row count per
  public table; size and SHA-256 of every file). It contains password
  hashes, TOTP secrets and client data: store it encrypted, off shared
  drives. `backups/` is gitignored. Not scheduled: someone runs it weekly.
- **Restore:**
  1. Create the target project and apply the migrations
     (`supabase db push`), so the schema comes from this repository.
  2. Load the app's data from `data.sql`: every `public` table plus
     `auth.users`, `auth.identities` and `auth.mfa_factors`, in one
     transaction with `session_replication_role = replica` (the
     append-only guards would otherwise refuse history rows). Supabase's
     own internals (sessions, tokens, Storage tables) are not restored;
     everyone signs in again.
  3. Upload the Storage files from `storage/`.
  4. Check row counts and file hashes against `manifest.json`.
- **Demonstrated** on 13 October 2026 with `scripts/restore-check.mjs`,
  which does steps 2-4 into the local Supabase stack (`supabase start`,
  which also showed every migration applies to an empty database): 28/28,
  every public table's row count equal, guard triggers enabled afterwards.
  That backup (dev, synthetic data) held no approval history and no Storage
  files, so the UPDATE-refused probe and the file upload/hash path didn't
  run. Restoring into a hosted throwaway project has not been done.

## What is explicitly NOT done here

- No Vercel project has been created or configured.
- No custom domain has been connected.
- No production Supabase project exists.
- No real client data has been imported (correctly -- the handoff
  prohibits this without separate authorization).
