# Priority #7 follow-up review — 8 October 2026

Verdict: the major earlier API bypasses are closed, but the lifecycle history backstop has an additional transaction-ordering/reuse defect. Full spec J completion remains outstanding.

## Confirmed repairs

- Direct parent DELETE privileges are absent for anon/authenticated/service_role on projects, client_businesses and workspaces. None of these roles has TRUNCATE on any public table, verified against the live catalog. Parent BEFORE DELETE guards reject unchecked owner SQL as well.
- Creatives, answers, evidence, financial records, targets and share links have no-reparent triggers. The previously demonstrated archived-creative move is rejected in the expanded live suite.
- creative_approval_history is append-only. Approving then editing a creative no longer removes project retention, and an ever-approved creative cannot be deleted. The expanded live suite verifies this behavior and retained rows.
- Table lifecycle guards reject isolated unrecorded/disallowed owner updates. Archive revocation is performed by table triggers too.
- Concurrent project archive and client archive both queued behind an authenticated session holding/reactivating a link and completed without deadlock on this rerun (about 3.6s and 3.8s respectively). This establishes the tested interleavings, not all possible lock interactions.
- Project/client ordinary metadata edits retain approval while export-input edits invalidate it; ledger regressions passed.

## Medium: same-transaction lifecycle history is ambiguous and reusable

`private.lifecycle_event_in_this_transaction` identifies a transaction by `created_at = now()` and selects by random UUID. Both restore_project and its table backstop find the prior archive using `ORDER BY created_at DESC, id DESC`. All default event timestamps in a transaction are equal because now() is the transaction start time; UUID order does not represent insertion order.

Rollback-only reproduction through the actual public RPCs, repeated on 20 synthetic projects inside one transaction:

1. Archive from ACTIVE and restore to ACTIVE.
2. Move to ON_HOLD, archive again, then restore.
3. Expected: every final restore returns ON_HOLD, the state immediately before the latest archive.
4. Actual: 11 returned ACTIVE and 9 returned ON_HOLD; none raised an error. The restore RPC and table guard both accepted the wrong historical archive because they use the same ambiguous ordering.

The same probe also demonstrated event replay under the database-owner role with all guards enabled: RPC ACTIVE -> ON_HOLD, then RPC ON_HOLD -> ACTIVE, followed by direct UPDATE back to ON_HOLD. The third transition succeeded using the first RPC's existing matching event, leaving only two history records for three status changes.

Scope: these reproductions use multiple operations in one SQL transaction. The ordinary UI currently sends separate requests; no current UI/API-role exploit was demonstrated. The replay example requires database-owner SQL (authenticated direct project UPDATE remains revoked). Nevertheless, claims that every write path gets a fresh matching history record and that restore always uses the immediately preceding archive are false at the database boundary.

Fix with explicit insertion/operation ordering and an event bound to the particular transition, rather than timestamp equality plus existence of any earlier matching event. A monotonic event sequence can order archive events; an explicit transaction identity and transition revision/operation identity can prevent reuse. Transaction identity alone does not solve event replay. Add repeat archive/restore and reused-event regressions before declaring the backstop complete.

Relevant locations:

- `supabase/migrations/20261009100000_lifecycle_backstops.sql:168` — transaction-event helper.
- Same file, line 188 — created_at = now(); line 189 — UUID ordering.
- Same file, line 544 — restore archive selection.
- `supabase/migrations/20261009110000_client_edit_invalidation_scope.sql:44` — table restore backstop selection.
- `.qa-priority7-followup-probes.sql` — repeatable rollback-only reproduction and live privilege/migration checks.

## Verification and limits

- Independent reruns: unit 30/30; typecheck and lint exit 0; lifecycle 114/114, exit 0; ledger 69/69, exit 0.
- Lifecycle run muzj9ra7 and ledger run muzjcpsw each verified complete removal of their scoped fixtures, memberships, MFA factors and auth users.
- Live migration history contains 20261009100000 and 20261009110000.
- The extra SQL probes ended in ROLLBACK and did not persist fixture or business-data changes.
- Supplied `.qa-vera-run.log` records 87/87 and scoped cleanup; `.qa-browser-run.log` records 8/8 in 6.0m, with the stream error and a soft-deleted QA auth user. These two suites were reviewed from logs, not independently rerun this turn.
- Browser cleanup wording is accurate now: business fixtures/memberships/factors removed; anonymized auth/security-audit rows retained, with invalid_credentials checked by teardown. Soft deletion is not physical deletion of all rows.
- The supplied lifecycle/ledger logs also report the claimed 114/114 and 69/69 totals; current independent reruns confirm them.
- Historical creative approval backfill remains limited as disclosed. Approval timestamps/content that were already erased before the new history existed cannot be reconstructed from current rows alone.
- Stale deletion reauth still lacks a dedicated real aged-session regression in the lifecycle suite; earlier review verified rejection at the SQL-claims boundary. Browser stale approval rejection is a separate code path.

## Remaining product/spec work

- Spec J's authorized project package and selective deletion/retention workflow is still unbuilt.
- Generic archived sub-page write errors and the unexplained non-failing browser stream error remain.
- The implementation's project metadata invalidation scope matches export inputs, but the spec explicitly says changes to a "required project field" invalidate approval and lists timezone as required. Timezone edits now preserve approval. Clarify/update that recorded rule if export-input-only invalidation is the desired policy.
- Keep the proposed lifecycle matrix as a recommendation: reversible ON_HOLD, direct completion/archive, and completed-project reopening with a reason. Explicit product-owner acceptance must come from the user; this review does not record it on their behalf.

No application code, migrations, commits or deployment were changed. Only this review report and a rollback probe script were added.
