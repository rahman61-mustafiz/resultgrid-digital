# ResultGrid Digital

Internal Marketing OS for ResultGrid Digital. See `CLAUDE_CODE_BUILD_HANDOFF.md`
and the planning documents in the repo root for product scope and
confirmed decisions.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · shadcn/ui ·
Supabase (Postgres, Auth, Storage) · Zod

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in a Supabase project's
   values (create a free project at supabase.com for local development --
   never point `.env.local` at the eventual production project).
3. Apply the database schema: `npx supabase db push` (or run
   `npx supabase start` first to develop against a local Postgres via
   Docker, then `npx supabase db reset` to apply migrations).
4. Create the Owner account and workspace (one-time):
   `npm run bootstrap:workspace`
5. Start the dev server: `npm run dev`
6. Sign in at `/login`, then complete mandatory authenticator-app (TOTP)
   enrollment -- there is no way to skip this.

## Security model

- Single Owner account, mandatory TOTP, no public signup.
- 8-hour absolute session cap, 30-minute idle lock requiring a fresh TOTP
  challenge to unlock, 5-minute "recent reauth" window for sensitive
  actions (see `src/lib/auth/`).
- Row Level Security enforces workspace isolation and requires an AAL2
  (TOTP-verified) session for all workspace-scoped tables (see
  `supabase/migrations/`).
- `security_events` is an append-only audit log: UPDATE/DELETE/TRUNCATE
  are revoked at the grant level for every role, including `service_role`
  (only its INSERT is kept, for `src/lib/auth/security-log.ts`), plus a
  trigger, not just application code or an absent RLS policy.
- Every RPC is refused for an anonymous caller, a signed-in non-member
  (even after TOTP) and an Owner without TOTP:
  `scripts/qa-rpc-authorization.mjs` reads the RPC list from the API
  schema, calls each one with valid arguments for real fixtures, expects an
  authorization error, and checks the fixtures are unchanged. It found
  that `private.is_workspace_owner()` returned NULL (not false) for a
  non-member, so `if not ... then raise` let them through; fixed in
  `20261013100000_owner_guard_null_fix.sql`. The project lock helpers
  now check authorization before taking any lock
  (`20261010120000_advisor_fixes.sql`).
- `supabase db advisors`: the 27 "SECURITY DEFINER callable by
  authenticated" warnings are the app's RPCs, each guarded as above.
  Leaked-password protection is off (Rana, 13 October 2026: not now).
- Security headers on every response (`next.config.ts`): no framing,
  `form-action 'self'`, `Referrer-Policy: same-origin` (share-link
  tokens never leave in a Referer), `noindex`, HSTS. The CSP sets no
  script-src: inline scripts would need nonces.

## Modules

- **Navigation** (spec I03): Dashboard, Clients, Projects, Leads, Reports,
  Files, Exports, Settings.
- **Dashboard** (spec I02, M07, M12, M13; `src/app/(app)/dashboard`):
  - Filters: one project or all, and a period -- this/last week (Monday to
    Sunday), this/last month, this/last quarter, this year, or a custom
    range -- with dates in the workspace timezone
    (`src/lib/dates/periods.ts`). Each period is compared with the one
    before it (the previous calendar week/month/quarter/year, or the same
    number of days before a custom range).
  - Money in and out per category, per currency, this period against the
    previous one (`src/lib/finance/dashboard.ts`). A record counts only
    when its own dates fall inside the period; one that straddles the edge
    is left out and reported, never split or counted whole. Pending and
    disputed amounts are excluded and counted, estimated ones are counted
    and flagged, refunds subtract, currencies are never added together,
    and "No records" is never shown as zero. A comparison against a period
    with no records has no percentage.
  - Profit by project (both formulas, records inside the period only;
    INCOMPLETE when an input is missing), target progress (actual against
    target, "not recorded" when there is no actual; no met/missed judgment
    because some metrics are better lower), leads (new this period vs the
    previous one), and items needing attention.
  - Truthfulness warnings always show (period still in progress, records
    left out, exclusions, estimates, unverified evidence, several
    currencies). The other cards can be hidden per user
    (`dashboard_preferences`).
  - Every query is read in full, page by page (`src/lib/supabase/fetch-all.ts`).
    It assumes nothing about the server's page size: it asks for the rows
    after those already received and stops only on an empty page, and one
    extra row tells exactly 50,000 (complete) from more (too many). If a
    read fails or exceeds 50,000 rows, the cards depending on it say
    "unavailable" and a warning says why; they never show a partial total
    or 0.
  - With one project selected, dates are in that project's timezone (the
    rule its client report uses); with all projects, the workspace's. If
    that timezone can't be loaded, every date-based figure (money, profit,
    targets, new leads) is unavailable rather than computed in a guessed
    timezone.
  - Each card checks everything it depends on: money and profit need the
    projects, the records and the timezone; targets need the targets, the
    projects and the timezone; Needs attention marks its projects or
    follow-ups part unavailable when that read failed.
    `scripts/qa-dashboard-failure-states.mjs` renders the real dashboard
    component with each read failing in turn and checks which cards show
    figures and which say unavailable (no database access).
- **Lists** (spec I04): Clients, Projects, Leads, Files, Exports, Reports
  and each project's financial records have search, filters and sort, in
  the URL (GET forms, `src/components/list-filters.tsx`). Search is a
  literal, case-insensitive substring match: `searchAny` in
  `src/lib/list-query.ts` uses an escaped regular expression, because
  LIKE wildcards (and PostgREST's `*`) would otherwise change the meaning.
  Archived clients and leads are hidden by default and can be shown.
  A list shows at most 500 rows and then says "Showing the first 500 of N
  results"; the count is exact. Filters computed in the app (export
  archive state, active share links, follow-up due) read every row first
  (`fetchAll`), so a match is never lost behind a cap.
  - **Files** lists every project's evidence (links and files, current or
    removed). **Exports** lists every export package (archived ones
    filterable, all downloadable). **Reports** lists projects with whether
    their client report is available (approved) and their active share
    links.
  - **Leads can be archived and restored**, each with a required reason
    (`set_lead_archived`, append-only `lead_archive_events`). An archived
    lead is read-only, enforced by a trigger, until restored. Leads are
    never deleted.
  - Financial records are an immutable ledger with corrections, so they
    are filtered rather than archived.
  - `e2e/lists-dashboard.spec.ts` checks the navigation; that `%`, `_`,
    `*`, commas and dots in a search match literally; the archive filters,
    lead archive/restore and its guards; the files, records and reports
    filters; the dashboard's figures, comparison, warnings, profit and
    target progress for one project; hiding a card; and that on a phone
    search and filters work while edits stay disabled. Unit tests:
    `e2e/unit/dashboard.spec.ts`.
- **Clients & businesses** -- CRUD, archive/restore, permanent deletion.
- **Projects** -- CRUD, lifecycle + readiness state machines.
- **Transfer, lifecycle, archive and deletion rules** (spec B05-B07, D, J;
  migrations `20261008100000`-`20261009140000`, enforced in Postgres):
  - **No transfer.** A project's client is chosen once, at creation.
    `update_project_details` has no client parameter, and a table trigger
    rejects any change of `client_business_id`, even by the database owner.
    A project created under the wrong client is archived and recreated. A
    project's rows (answers, evidence, financial records, targets,
    creatives, share links) can't be moved to another project either.
  - **Lifecycle** changes only through `set_project_lifecycle` /
    `restore_project`: ACTIVE -> ON_HOLD / COMPLETED / ARCHIVED; ON_HOLD ->
    ACTIVE / COMPLETED / ARCHIVED; COMPLETED -> ACTIVE (reopen, reason
    required) / ARCHIVED; ARCHIVED -> back to the status it had when
    archived. New projects always start ACTIVE + INCOMPLETE. The table
    trigger enforces the same matrix, restore target and reopen reason, and
    refuses any status change (project or client) that doesn't advance its
    revision (`lifecycle_revision` / `status_revision`) by exactly one,
    backed by the `lifecycle_events` row for that revision written by the
    same transaction (only the RPCs can write it). One event backs one
    transition, so a service-role or database-owner update can't skip the
    rules or the history, or reuse an earlier event. Events are ordered by
    an identity `seq`, so restore uses the latest archive even when several
    happen in one transaction. The matrix was explicitly
    confirmed by Rana on 9 October 2026 and is recorded in
    `BUILD_READINESS_QUESTIONNAIRE.md` section D.
  - **Archive.** An archived project, and every project of an archived
    client, is read-only: answers, evidence, financial records, targets,
    creatives, exports and new or re-enabled share links are all refused by
    triggers on those tables. A client can be archived only when none of
    its projects is ACTIVE or ON_HOLD, and gets no new projects until
    restored. Archiving revokes the affected share links and ends open
    viewer sessions (from a trigger, whatever the write path). Approval is
    untouched, except that a client edit that would invalidate approval
    (below) still invalidates an archived project's approval.
  - **Permanent deletion** (`delete_project_permanently`,
    `delete_client_business_permanently`): Owner only, password + TOTP
    within 5 minutes (checked in the database from the token's `amr`, as
    well as in the app), the exact name typed, archived for 30+ days. A
    project with exports, approval history, financial records, or a
    creative that was **ever** approved or published is never hard-deleted;
    the UI says which history keeps it. Creative approvals/publications are
    recorded in the append-only `creative_approval_history` when they
    happen, so editing an approved creative (back to CHANGES_REQUESTED)
    doesn't lose that protection, and such a creative can't be deleted. A
    client is deletable only once it has no projects. No API role has
    DELETE on projects, clients or workspaces (or TRUNCATE on any table),
    and BEFORE DELETE triggers refuse a project/client delete that the RPC
    didn't record in the same transaction, including by the database owner.
  - Every change is recorded in the append-only `lifecycle_events` table
    (actor, from/to, reason), which keeps the id and name, so a record of a
    deletion outlives the deleted row.
  - **Lock order** is client -> share links -> project -> other child
    rows. Archive takes the share links before the project, the same order
    a direct share-link update takes, so archive and a concurrent link
    reactivation queue instead of deadlocking (tested with two real
    sessions).
  - **Approval invalidation** (spec D08): editing a required field or an
    export input invalidates -- a project's name, type, custom type label,
    currency, export language or timezone, or a client's name, record type,
    country or timezone. Notes, tags, description, dates and client contact
    details don't.
- **Questionnaire** -- E01-E14, all 130 questions in
  `QUESTIONNAIRE_V1_DRAFT.md` (127 required, 3 optional), autosaving as
  drafts. Rules live in `src/lib/questionnaire/engine.ts`:
  - **Conditions.** A question applies, or becomes optional, based on
    earlier answers and the project type (spec F05), e.g. ads out of scope
    in E09.Q01 removes the ad questions, and contact methods are optional
    before launch. Most "X is in scope" conditions read the in-scope list
    in E13.Q02. A question whose controlling answer is still empty stays
    shown and required, so an unanswered question never removes a
    requirement. Questions that don't apply are not required, shown only
    as a one-line note, and not exported.
  - **Structured answers.** Choices, multi-selects, countries, URLs,
    dates, amounts with currency, and their cross-field rules (hard cap >=
    planned spend; final date and milestones not before the start date;
    primary language among those selected; "None" exclusive; draft-only
    values such as "No exclusions identified yet") are real fields, plus the
    draft's text length limits.
  - **Two levels of checking.** Every save rejects values that can't
    belong to the question (unknown question or field, option not in the
    list, malformed date); the database also rejects unknown question keys
    (`20261007100000`). Incomplete or invalid drafts still save; their
    issues show under the field and on the readiness review, and block
    mark-ready and approval.
  - **Accepted deviations from the draft** (decided 7 Oct 2026, option B):
    repeatable tables (one row per offer, goal, KPI, asset, ...) are long
    text with the per-line format shown under the field; that format is
    not validated. Conditions tied to individual rows of those tables
    (E02.Q02-Q04, E03.Q05/Q06/Q08, E06.Q02-Q07, E10.Q01, E11.Q02/Q05) are
    not modelled, so those questions stay required with documented fallback
    answers. Approximations: E10.Q07 ("meeting booking or quote is a
    selected action") uses "lead capture in scope"; E13.Q07 always
    applies; "Not decided" in E09.Q01 counts as ads in scope; the brand
    trait, language, alternative, and authority option lists are ours
    (the draft names the kind of choice, not the options); contradictory
    brand traits are not detected.
  INTERNAL and SENSITIVE answers (including access/inventory answers) are
  excluded from AI exports.
- **Readiness & approval** -- missing/invalid-answer validation, Owner-only
  approval (requires recent password+TOTP reauth), deterministic
  3-file export (`PROJECT_CONTEXT.md`, `EVIDENCE_INDEX.md`,
  `EXPORT_MANIFEST.md`), versioned and immutable. The ZIP is named
  `ResultGrid-Digital_{client}_{project}_{YYYY-MM-DD}_vNN` (date in the
  workspace timezone; the name is recorded in the manifest), and
  `PROJECT_CONTEXT.md` downloads on its own too (H01, H07, H08). Attached
  evidence is referenced in `EVIDENCE_INDEX.md` by name, type, size and
  SHA-256, never copied in. Exports can be archived and restored, each
  with a required reason (an append-only `project_export_archive_events`
  log; `set_export_archived` refuses a blank reason), never deleted (H09);
  archived ones stay downloadable.
  Required questions can only be satisfied by a real answer -- NOT_APPLICABLE
  never counts toward a required question, enforced both server-side
  (`setAnswerStatusAction`) and in readiness scoring
  (`src/lib/questionnaire/readiness.ts`), not just hidden in the UI.
  Mark-ready and approval both check readiness on the same one-read
  snapshot the export is rendered from and pass its fingerprint;
  `submit_project_for_review` (migration `20261007110000`) and the export
  RPCs re-verify it under lock and reject with `PT409` if any answer,
  evidence, project or client field changed after the check, so a
  concurrent save can't slip an invalid answer past either step.

  Every write that can affect approval state -- a readiness transition
  itself, or an edit to questionnaire answers/evidence/project fields/
  client fields that must invalidate an existing approval -- happens
  through a single `SECURITY DEFINER` Postgres function that performs the
  mutation AND the readiness/ledger bookkeeping together, in one
  transaction: `submit_project_for_review`, `approve_and_export_project`,
  `record_project_export`, `upsert_project_answer`, `add_evidence_item`,
  `delete_evidence_item`, `update_project_details`,
  `update_client_business_details` (plus the lower-level
  `invalidate_project_approval`/`invalidate_client_approvals` these last
  four call internally -- see `supabase/migrations/20260922120000_*.sql`
  through `20260922160000_*.sql`). Earlier drafts called the write and its
  invalidation as two separate round trips from the app; that left a
  window where the write could succeed and the invalidation fail (or be
  skipped) independently, leaving APPROVED data stale. There is no such
  window now -- a forced failure partway through either half rolls back
  the whole call, proven by `scripts/qa-approval-ledger-acceptance.mjs`'s
  atomicity tests (an intentionally invalid write is rejected and leaves
  *neither* the data *nor* the readiness status changed).

  The actor and timestamp on every ledger row are set by the function
  itself (`auth.uid()`/`now()`), never client-supplied. Direct writes to
  `readiness_status`, `project_answers`, `evidence_items`, and the
  export-relevant columns of `projects`/`client_businesses` are revoked at
  the database layer for every role that reaches it through the app --
  anon, authenticated, **and service_role**, which bypasses RLS entirely
  and so needed its own explicit table-level revoke, not just "no RLS
  policy" (RLS-only defenses look sufficient until tested against the role
  that skips RLS). TRUNCATE is revoked the same way plus a statement-level
  trigger (TRUNCATE fires no row-level trigger, so the existing
  immutability triggers alone didn't cover it), and every ledger RPC's
  EXECUTE privilege is revoked from PUBLIC/anon/service_role, leaving only
  `authenticated`. `approve_and_export_project` creates the immutable
  `project_exports` snapshot in the same transaction as the approval and
  binds the ledger's `APPROVED` event to its exact version, so an approval
  can never exist disconnected from what it approved.

  The export content must also match what gets approved. The app renders
  the Markdown from ONE consistent read (`get_project_export_snapshot`),
  which includes a fingerprint of exactly the fields the generator uses.
  `approve_and_export_project` and `record_project_export` require that
  fingerprint and recompute it after locking the client row and then the
  project row, the same order every writer of those fields uses. Any edit
  made after the export was generated, including a client edit still in
  flight, is rejected with `PT409` (HTTP 409; not `40001`, which PostgREST
  retries), and the Owner sees "The project changed while this export was
  being prepared" (migrations `20261006100000`-`20261006120000`).

  This is exercised end to end, against the real dev Supabase project
  through a real password+TOTP session (not mocked), by
  `scripts/qa-approval-ledger-acceptance.mjs` -- run it with
  `node --env-file=.env.local scripts/qa-approval-ledger-acceptance.mjs`
  after any change to the ledger migrations or the RPC-calling code. Both
  DB scripts need a logged-in Supabase CLI linked to the dev project. On
  exit each removes exactly what its own run created -- client, project,
  ledger, exports, membership, MFA factor, auth user (hard-deleted) -- via
  `scripts/lib/qa-fixtures.mjs`, and verifies every removal with queries
  whose errors fail the cleanup rather than reading as "0 left". Other
  runs' fixtures are never touched. `scripts/qa-purge-fixtures.sql`
  remains only as a manual tool for clearing old leftovers.

  `scripts/qa-vera-wellness-e2e.mjs`
  (`node --env-file=.env.local scripts/qa-vera-wellness-e2e.mjs`) is a
  **DB-integration** acceptance run of the demo flow in
  `SEED_PROJECT_RESULTGRID_DIGITAL.md`'s "MVP acceptance seed", using
  "Vera Wellness" as a synthetic fixture name (never real data): Owner
  access at aal2, all 130 questionnaire question keys (written through the
  RPC directly, so answer shapes are not checked there -- see Known gaps),
  approval + export, all
  7 financial categories, targets/actuals, evidence, the client report
  computation (client profit, targets, period filtering, no internal
  RGD figures in the client object), share-link PIN/lockout/nonce logic
  on real rows, and export version storage. Server-only modules can't be
  imported into plain Node, so their pure logic is reimplemented in the
  script as faithful copies. It also holds the deterministic regressions
  for consistency, each using a second database session whose lock is
  proven (a baseline read must succeed, then only a timeout counts as
  "blocked"): the report read is held mid-statement while an edit +
  re-approval commits and must return one consistent pre-edit snapshot;
  an approval generated before an edit is rejected as stale even though
  its version still matches; and an approval started while a client edit
  is uncommitted waits for it, then rejects as stale.

  **Application E2E** (`npm run test:e2e`, Playwright, `e2e/`) builds and
  starts the production app on port 3100 and drives it in Chromium:
  password + TOTP enrollment (secret read from the enrollment screen), a
  fresh sign-in for approval, mark-ready and approve through the UI, the
  real export generator and ZIP download (checked byte-for-byte against the
  stored snapshot, plus INTERNAL/SENSITIVE answers excluded), share-link
  creation, wrong PIN x5 -> lockout, correct PIN refused during lockout,
  success after lockout, share cookie attributes (httpOnly, Secure,
  SameSite=Lax, path-scoped, ~2h, DB stores only its hash), forged cookies
  rejected, rendered report figures/targets/period filtering, no internal
  figures/notes/answers in the rendered page or any response the client's
  browser received, revocation ending an already-open session, and
  approval refused once password auth is older than 5 minutes. In the
  questionnaire it answers a text question and a structured date question
  through the form, checks that an invalid draft shows its issue and blocks
  readiness, that a failed save (request aborted) is reported and clears
  "Saved", and that taking ads out of scope hides the ad questions and
  restores them with their answers. Seeding
  with no UI step in this journey (answers, financials, targets, evidence)
  goes through the same RPCs the server actions call, as the same user.
  Teardown purges only this run's fixtures and verifies each removal
  (a failed verification query fails the teardown). The QA auth user is
  soft-deleted, not hard-deleted, because the app's login writes
  append-only `security_events` rows that reference it. The teardown
  requires both `deleted_at` set with the email anonymized and a sign-in
  with the old credentials rejected specifically as `invalid_credentials`
  (any other error, e.g. network or rate limit, fails the teardown), and
  reports the soft delete separately in the run output.

  `scripts/qa-lifecycle-acceptance.mjs`
  (`node --env-file=.env.local scripts/qa-lifecycle-acceptance.mjs`) is
  the DB-integration acceptance for the transfer/lifecycle/archive/delete
  rules. It covers:
  - creation defaults
  - transfer refused, including for the service role and the database owner
  - every allowed and refused lifecycle edge
  - archived projects and clients refusing each kind of write
  - share links revoked and not re-enabled
  - restore to the previous status
  - the 30-day, typed-name and retained-history deletion rules
  - append-only history
  - direct deletes refused for the Owner, the service role and the database
    owner, with the retained rows checked afterwards
  - no reparenting of an archived project's creative or any share link
  - creative retention surviving an edit after approval
  - database-owner lifecycle writes held to the matrix and the history
  - several archive/restore cycles in one transaction restoring to the
    latest pre-archive status, and an earlier event not reusable
  - archive (project and client) racing a share-link reactivation held
    in a second session: no deadlock, the archive queues and wins

  Moving `archived_at` back 31 days is test control, run as the database
  owner. It does not cover the stale-reauth refusal of the delete RPC with a
  real aged session; the same `amr` check is exercised for approval in the
  browser suite.
  The browser suite also archives the Vera project through the UI and
  checks the read-only refusal in the questionnaire, the retained-history
  notice, and restore.

  **Unit tests** (`npm run test:unit`, `e2e/unit/`, no browser or server)
  cover the rules engine: definition integrity (every condition, field
  reference and rule resolves; the database's key list equals `v1.ts`),
  conditions, save-time shape checks, readiness issues, and export
  rendering of structured and excluded answers.
- **Financials** -- 7 record categories, profit formulas that report
  INCOMPLETE (never a false zero) when required inputs are missing,
  corrections with preserved history, CSV import with preview/validation.
  Client profit counts only CLIENT_OWN_REVENUE records explicitly marked
  `attributed_to_marketing` -- never total client revenue -- and a record
  can't be marked attributed without both a non-Unverified evidence status
  AND a real evidence link (`evidence_url is not null`), enforced by a
  database CHECK constraint, not just form validation
  (`financial_records_attribution_rules`; evidence status alone was
  insufficient in an earlier pass -- OWNER_REPORTED with no link doesn't
  count as evidence). `set_financial_record_attribution` is the supported
  path for adding evidence/attribution to a record after the fact (the
  amount-correction RPC never touched those fields). Every write
  (add/correct/attribution-edit/bulk-import) goes through a
  `SECURITY DEFINER` function that invalidates an APPROVED project
  atomically, the same way questionnaire/evidence/project edits do -- see
  `supabase/migrations/20260923100000_attribution_and_report_periods.sql`
  and `20260923120000_attribution_evidence_and_truncate_fix.sql`.
- **Targets & KPIs** -- target-vs-actual per metric/period; the same
  atomic write+invalidate pattern applies here too.
- **Evidence** (spec F06, J01, J03) -- a link (Drive, report) or an
  attached file, with category, verification state and date. No Drive API
  integration (J01 keeps big files in Drive).
  - **Attachments**: PDF, DOCX, XLSX, CSV, PNG, JPG/JPEG, WEBP or MP4, up to
    25 MB, in the private `evidence` Storage bucket, which enforces the size
    and types itself.
    1. `prepare_evidence_upload` (Owner, project open, allowed type and
       size) records a pending upload in `evidence_uploads` and generates
       its object path; the server then issues a one-time signed upload URL
       for that path. The browser uploads straight to Storage (the file
       never passes through the app server).
    2. The server downloads the object, checks the bytes are the type the
       recorded file name claims (a PNG renamed .pdf is refused) and hashes
       them (SHA-256). It records the result with
       `record_evidence_upload_verification`, which only the service role
       can call; it binds the result to the stored object's id and version,
       and the object's size and type must match.
    3. `add_evidence_attachment(project, upload)` records exactly what the
       server verified -- the caller supplies no file details. It refuses an
       upload that isn't verified, isn't the caller's or is on another
       project, re-checks that the object is unchanged, and returns the
       existing item when replayed.
    A failed byte check discards the upload; a recorded upload can never be
    discarded. Field errors leave the upload to retry. Nobody reads, lists
    or deletes the bucket directly; downloads go through
    `/projects/[id]/evidence/[itemId]/file`, which checks access with the
    caller's session and redirects to a 60-second signed download URL.
  - **File deletion** goes only through `storage_cleanup_queue`. Deleting
    an evidence row (however it happens, including the permanent project
    deletion cascade) or discarding an upload queues its file in the same
    transaction. The app works through the queue after each evidence
    change and on demand (`src/lib/evidence/storage-cleanup.ts`); it never
    deletes a path an evidence row (removed ones included) or an open
    upload still uses, and confirms the object is gone. A failure stays
    queued with its error and is retried; pending deletions show on the
    project's evidence page and in Settings with a retry button. Uploads
    left unfinished for 24 hours expire and are queued.
  - **Retention**: which evidence each export contains is recorded at
    export time (`project_export_evidence`). Removing evidence needs a
    reason. Evidence that is part of any export is kept, marked removed,
    with its file, and drops out of new exports; anything else is deleted,
    file included. Removed evidence can't be changed and exported evidence
    can't be deleted, even by the database owner. A permanently deleted
    project's files are queued for deletion too.
  - `scripts/qa-evidence-acceptance.mjs` covers the bucket settings, direct
    access refused, the review's bypass (PNG bytes as a .pdf with a false
    hash: no longer recordable), verification binding, replay, tampering,
    the deletion queue (referenced paths skipped, expiry, a failed delete
    kept and retried), retention with and without an export, and export
    archiving with required reasons. The browser suite uploads through the
    real form (a renamed file and a disallowed type are refused), replays
    the captured finalize request as is, with invalid fields, an unknown
    upload and the discarded upload (nothing is deleted or duplicated),
    downloads the file, checks its reference in the approved export,
    removes it after approval (kept), deletes an unexported link, and
    archives/restores the export with reasons.
- **Creatives** -- DRAFT -> review -> APPROVED -> PUBLISHED workflow;
  editing an approved version bumps the version and invalidates approval.
- **Leads** -- stage tracking, duplicate detection by normalized
  phone/email, manual follow-up reminders (nothing sends automatically).
- **Client reports & share links** -- PIN-protected, expiring, revocable
  read-only links (`/share/[token]`) showing only the client-safe profit
  view and targets -- never ResultGrid Digital's internal margin/fee
  breakdown or internal notes. Access is gated by a server-issued session
  nonce (hash stored server-side, raw value only in an httpOnly cookie) so
  the "verified" state can't be forged by setting a guessable cookie value,
  and PIN attempts are rate-limited (5 tries, then a 15-minute lockout) to
  resist brute-forcing the 6-digit PIN. See `src/lib/domain/share-link.ts`.
  The report itself is only viewable while the project is APPROVED
  (`buildClientReport` returns `{ ok: false, reason: "NOT_APPROVED" }`
  otherwise, on both the public share page and the Owner's internal
  preview) -- an "approved snapshot" guarantee only holds if every write
  that could change the numbers also invalidates the approval, which now
  covers financial records and targets as well as questionnaire/evidence/
  project fields (see Financials above), AND if the report's own read is
  internally consistent. `buildClientReport` gets status, financials and
  targets from a single statement (`get_client_report_snapshot`,
  service_role-only EXECUTE), so they always come from one snapshot.
  Earlier versions used separate reads; reordering them narrowed the
  window but couldn't close it (an edit plus a full re-approval could
  still land between reads).
  - **Periods and calculation rules** (`src/lib/reports/report-rules.ts`,
    migration `20261010110000`) are versioned per share link, so a link a
    client already has never changes its numbers silently. **v2** (new
    links and the Owner's preview) uses the dashboard's rules: dates in the
    project's timezone, weeks/months/quarters/year, and only records dated
    entirely inside the period (one straddling the edge is left out and
    noted). **v1** (links created before 10 October 2026) keeps the
    original rules: all time/this month/last month/this quarter/this year
    by the server's clock, and overlapping records counted in full. The
    report states its rules; the share-links page shows each link's
    version; the preview can show v1 and says how many active links use
    it. Every target in the period is shown (no display cap).
- **Mobile is view-only** (spec A07/I08). On a phone the Owner can sign
  in (password + TOTP), unlock, recover, sign out, and view the dashboard,
  clients, projects, questionnaire, financials, reports and audit log;
  clients can open share links and enter the PIN. Nothing else can be
  written:
  - `src/proxy.ts` refuses every non-GET request from a phone with 403,
    except on `/login`, `/setup/totp`, `/lock`, `/recovery`, `/share` and
    `/auth/sign-out` (`src/lib/device.ts`).
  - Every app Server Action calls `assertEditingAllowed()` first
    (`src/lib/auth/edit-policy.ts`) as a second layer.
  - The app layout shows a view-only banner and disables every write
    control in the page (`src/components/view-only-guard.tsx`, plus a CSS
    rule that blocks clicks before JavaScript loads). Search and filter
    forms (GET) and links stay usable, since they only read.
  - Sign-out is a POST route (`src/app/auth/sign-out/route.ts`, with a
    same-origin check) instead of a Server Action, so it can be allowed by
    path. The proxy lets it through in every auth state, and the TOTP
    setup, TOTP verify and lock screens each offer "Sign out instead". It
    also clears the app's session cookies, so a later sign-in doesn't
    inherit an idle lock. `e2e/sign-out-states.spec.ts` signs out from
    enrollment, pending verification (on a phone) and the lock screen, then
    signs in again unlocked, and checks a cross-site sign-out is refused.
  `e2e/mobile-view-only.spec.ts` (Pixel 7 emulation) signs in and enrolls
  TOTP on the phone, views each area, re-enables the form in the DOM and
  edits (the server refuses with 403 and the stored answer is unchanged),
  posts to other app paths (403, also with an iPhone User-Agent and no
  client hints), and signs out. The Vera suite's client opens the share
  link and enters the PIN on a Pixel 7. Unit tests cover the detection
  rules (`e2e/unit/device.spec.ts`).
- **Settings** -- password change, TOTP reset, security audit log
  (both gated by recent reauth where required).
- **Recovery** -- break-glass TOTP-factor replacement via a password
  check + emailed link (Supabase's built-in mailer), forcing new
  enrollment and revoking all sessions.

### Known gaps

- The **data export/deletion request** flow (spec J: package the project,
  then delete eligible data while keeping records that must remain, with
  the reason recorded) is not built. A project with retained history
  stays whole and archived; nothing inside it is partially purged.
- On an archived project, the questionnaire and the project/client pages
  explain the read-only state, but the evidence, financials, targets,
  creatives and share-link pages only show their generic "Could not ..."
  error when a write is refused.
- **Evidence attachments:** the 25 MB limit (J01's "separate technically
  verified upload limit") was confirmed by Rana on 9 October 2026. Type checks are by file signature, not a malware scan, and
  "short" MP4 is only enforced by size (any `ftyp` header passes; the
  brand isn't checked). CSV is checked as UTF-8 without NUL bytes in its
  first 64 KiB; DOCX/XLSX only need their main ZIP part. The deletion
  queue runs when evidence changes, when someone presses retry, and daily
  at 03:00 Dhaka from `/api/cron/storage-cleanup` (`vercel.json`; needs
  `CRON_SECRET`, sent by Vercel Cron as a bearer token; without it the
  route refuses every call). A run with a failed deletion answers 500. A signed download URL works for anyone holding it during
  its 60 seconds. Exports made before package names were recorded are
  named from the current client/project names.
- The database owner can still disable the guard triggers; the QA purge
  scripts do that for synthetic fixtures inside one transaction. Every
  other path is held by the triggers.
- `creative_approval_history` was backfilled from creatives that were
  APPROVED/PUBLISHED when it was added. A creative approved and then edited
  before that has no record (the dev database held only QA data then).
- The archive/reactivation race test was run against the new lock order
  only; it was not shown to deadlock under the old one.

- Answer **shape** and readiness rules are enforced in the app's server
  code, not in Postgres. The database rejects unknown question keys, but an
  Owner calling `upsert_project_answer` directly through the API can still
  store a malformed value. Readiness never trusts a stored value: it
  re-runs the save-time shape check on every answer first (`answerIssues`
  in `engine.ts`), so such a value is reported as invalid and blocks
  mark-ready and approval in the app (unit-tested, and exercised in the
  browser suite with a value stored directly through the RPC). An Owner
  calling `submit_project_for_review` directly can still mark a project
  ready without the app's rules, but it must pass a current fingerprint,
  and approval through the app recomputes readiness anyway. Porting the
  rules engine to SQL was judged not worth the duplication for a
  single-Owner system.
- Changing a project's type can change which questions apply; the stored
  readiness status is not recomputed until the next answer save, but the
  readiness review, mark-ready and approval always recompute.

- Proactive **security alert emails** (new-device login, password
  changed, etc.) are not implemented -- Supabase's built-in SMTP only
  sends its own fixed auth-flow templates, not arbitrary custom content.
  Every event is still logged and visible at Settings -> audit log.
- **Mobile view-only** is decided from request headers
  (`Sec-CH-UA-Mobile`, else the User-Agent), so it is a product rule, not
  a security boundary: "Request desktop site" or a changed User-Agent gets
  the desktop experience. Tablets with a desktop User-Agent count as
  desktop. The per-action guard (second layer) isn't tested on its own:
  the browser test can only reach actions through the proxy, which
  refuses first. On a phone, links to edit pages still open them, with the
  form disabled.
- The client report reads all of its data in one statement
  (`get_client_report_snapshot`, migration `20260923140000`), so an edit
  plus re-approval can't interleave with it; see the lock-forced
  regression in `scripts/qa-vera-wellness-e2e.mjs`.
- Auth users with audit/ledger history can't be hard-deleted:
  `security_events.user_id` and `project_approval_events.actor_id` are
  `ON DELETE SET NULL` on tables that forbid UPDATE. Intended for real
  accounts (history is never rewritten). The DB scripts purge their own
  ledger rows first and can then hard-delete their QA user; the browser
  suite's user also has `security_events` rows, so it is soft-deleted.

## Project structure

```text
src/
├── app/            # routes (App Router)
├── components/ui/  # shadcn/ui primitives
├── lib/
│   ├── auth/       # session policy, reauth, device recognition, audit log
│   ├── env/        # Zod-validated environment access (client vs server)
│   └── supabase/   # browser / server / admin Supabase clients
└── proxy.ts        # route protection + session lock (Next.js middleware)
supabase/
└── migrations/     # schema + RLS, applied in filename order
scripts/
└── bootstrap-workspace.mjs  # one-time Owner + workspace creation
```
