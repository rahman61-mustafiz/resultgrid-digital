# Priority #7 revision verification

Reviewed on 8 October 2026 (Asia/Dhaka). Verdict: the latest lifecycle/history fixes work in the independently tested scope. No new blocking defect was found in this round. Full spec J delivery is still incomplete.

## Story and flow status

An Owner signs in with password and TOTP, edits project/client metadata or uses lifecycle controls, the Server Action calls the database RPC, the database validates authorization/transition/revision/history, and the app renders the resulting state. Approval produces immutable export files; client viewer access uses a PIN and a server-issued cookie and ends on revocation.

| Boundary | Status | Evidence |
|---|---|---|
| UI and production server | Passed | Production build started; real Chromium sign-in, TOTP and archive/restore assertions passed. |
| UI → Server Action → database | Passed | Mark-ready, approval and lifecycle transitions exercised through the app. |
| Database history and protection | Passed | Live lifecycle 120/120, ledger 75/75 and independent rollback probes. |
| Database → generated export | Passed | Browser downloaded the real approved ZIP and validated contents. |
| Database → viewer response | Passed | PIN, lockout, nonce cookie, rendered report, absence of internal data, and revoked-session rejection passed. |
| Aged authentication → delete refusal | Passed | Real password and TOTP session older than 300 seconds rejected by both permanent-delete RPCs with SQLSTATE 42501 and the specific recent-reauth message; project/client counts remained one each. |

## Independent results

| Check | Result |
|---|---|
| Unit tests | 30/30 |
| TypeScript | Exit 0 |
| Lint | Exit 0 |
| Lifecycle database suite | 120/120, exit 0; run muzn61l5 |
| Ledger database suite | 75/75, exit 0; run muznam6z |
| Vera database suite | 87/87, exit 0; run muznbwa5 |
| Production-build browser suite | Original 8 tests plus one temporary aged-delete audit test: 9/9, exit 0, 5.9 minutes |
| Repeated archive/restore probe | Correct ON_HOLD target in 20/20 projects; no wrong targets or errors |
| Project event replay | Rejected without revision bump, with manual bump, and for counter-only mutation |
| Client event replay | Same three rejection cases verified; two archive/restore cycles left revision 4, four history events and ACTIVE state |
| Live migration history | Includes 20261009120000, 20261009130000 and 20261009140000 |
| API privilege check | No anon/authenticated/service_role parent DELETE or public-table TRUNCATE leaks |

The sequence orders archive history correctly. Events carry the current transaction identity. A unique entity/revision event and exact +1 counter validation prevent the previous event-reuse path. The earlier 11/20 wrong restores are not reproducible with the new migrations.

The expanded lifecycle suite also confirmed the earlier direct-delete, child-reparenting, creative-retention and table-transition protections. Both project/client archive races overlapped a real authenticated share-link reactivation session, queued around 3.6s/3.8s, and ended with the link revoked and no deadlock. This verifies those interleavings, not every possible concurrent operation.

The ledger suite confirmed notes/tags/description/date metadata edits preserve approval and required project/client timezone edits invalidate it. Keeping timezone invalidation follows the confirmed required-field policy; no export-only revert is recommended.

## Real aged-session deletion coverage

A temporary copy of the existing browser suite added one final audit test. It read the real seeded Owner session's password/TOTP AMR timestamps, allowed both to age beyond 300 seconds, and called the actual project and client permanent-delete RPCs. Both returned 42501 with "permanent deletion requires a password + TOTP sign-in within the last 5 minutes". The original project/client were still present afterwards.

These are real signed session claims, not owner SQL that fabricates old timestamps. The rows did not otherwise qualify for permanent deletion; the exact error proves the reauth boundary rejected them before later lifecycle/retention checks. Fresh-session eligible deletion is separately exercised in the lifecycle suite.

The audit copy was removed after verification, so default test discovery still runs the original eight browser tests. This closes the behavioral uncertainty for this review, but the permanent suite still needs a dedicated aged-delete regression if ongoing coverage is desired.

## Cleanup and operational state

- Lifecycle, ledger and Vera reruns each verified removal of their scoped business fixtures, memberships, MFA factors and auth users.
- Browser teardown verified zero clients, projects, workspace memberships and MFA factors for its run. Its auth user was soft-deleted: deleted_at set, email anonymized, and old credentials rejected as invalid_credentials. The anonymized auth row and security-audit history remain because of audit foreign keys.
- Extra SQL probes ended with ROLLBACK. A follow-up live query found zero probe clients/projects and zero clients from the independent lifecycle run.
- All nine inspected deletion/lifecycle/history guard triggers were still enabled after cleanup.
- The stream error appears in the supplied run log, but did not appear in this independent browser run. Its root cause remains unknown; this run does not establish that it is resolved.
- No application source, migrations, spec decisions, commits or deployment changed. Only audit probes/logs and this report were retained. The temporary browser test copy was removed.

## Remaining scope and decisions

- Spec J's authorized project package and selective deletion while retaining mandatory records is not built. A retained project still remains whole and archived.
- Archived evidence/financial/target/creative/share-link sub-pages still expose generic write-refusal messages.
- Old creative approval/publication history erased before the new history table cannot be reconstructed from current rows alone; the disclosed backfill limitation remains.
- The database owner can override database protections through privileged administrative changes; this is not an ordinary API path.
- Recommend keeping the lifecycle matrix, including completed-project reopening with a reason. The user's explicit product acceptance must be recorded before treating the matrix as confirmed. This review does not supply that acceptance.

## Evidence artifacts

- `.qa-lifecycle-independent-latest.log`
- `.qa-ledger-independent-latest.log`
- `.qa-vera-independent-latest.log`
- `.qa-browser-independent-latest.log`
- `.qa-revision-independent-latest.log`
- `.qa-final-state-independent-latest.log`
- `.qa-priority7-revision-probes.sql`
- `.qa-priority7-final-state.sql`
