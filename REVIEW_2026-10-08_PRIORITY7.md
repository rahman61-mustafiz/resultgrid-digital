# Priority #7 independent review — 8 October 2026

Verdict: partial. The intended RPC paths work, but passing the current acceptance suite does not establish the claimed database-wide protection. Three significant gaps reproduced against the linked development database.

## High: service-role parent deletes bypass permanent-delete policy

`service_role` still has DELETE on `public.projects` and `public.client_businesses`. Neither parent table has a BEFORE DELETE policy trigger. The checks and deletion history exist only inside `delete_project_permanently` and `delete_client_business_permanently`.

Rollback-only reproduction, with triggers enabled: `SET LOCAL ROLE service_role` directly deleted a newly archived synthetic project and an ACTIVE synthetic empty client. No recent reauthentication, exact-name confirmation, or 30-day wait was supplied, and no lifecycle deletion event was recorded. The project also had a synthetic financial record; it cascaded away. Thus the financial-history protection is bypassable as well.

Revoke direct parent DELETE privileges from service_role (and audit all relevant roles/grants), keep deletion behind the checked RPCs, and add parent deletion backstops if database-owner/future-function protection is intended. Regression coverage must attempt direct deletion and verify retained rows/history.

## High: a creative can be moved out of an archived project

`private.assert_project_accepts_work` selects NEW.project_id on UPDATE. It never checks OLD.project_id. `creatives` still has authenticated UPDATE grants and an Owner UPDATE policy, including its project_id column.

Rollback-only reproduction under `SET LOCAL ROLE authenticated`, with an existing Owner identity and AAL2 claims: moving a creative from an ARCHIVED source project to an ACTIVE destination succeeded. This modifies the archived project's contents through the user-accessible database boundary. No application form for reparenting is required.

On UPDATE, validate both old and new parents, or prohibit child reparenting. Review every trigger using this shared function and the share-link update path. Add a regression for changing project_id on an archived child's row.

## High: historical creative approval/publication does not preserve retention

`public.project_retained_history` only recognizes creatives whose CURRENT status is APPROVED or PUBLISHED (20261008100000, line 622). The real `updateCreativeContentAction` changes either state to CHANGES_REQUESTED, clears approval fields, and keeps previous content in mutable version_history.

Rollback-only reproduction: retained-history output was `["approved or published creatives"]` while APPROVED, then `[]` after the same status/approval-field changes the app makes when editing. Prior creative history therefore no longer blocks later project deletion. Such a project can become eligible after the recovery period if it has no other protected records. This is an app-reachable loss of retention protection, independent of the service-role delete bypass above.

Preserve immutable approval/publication events or an irreversible historical marker and base retention on history, not current creative status. Also review the existing Owner creative DELETE policy, which currently permits deleting approved creatives while the project accepts work.

## Database-owner lifecycle backstop is incomplete

The transition matrix, reopen-reason requirement, share revocation and lifecycle-event insertion live in RPCs. `private.enforce_project_update` checks transfer/archive restrictions but does not enforce lifecycle edges or insert history.

Rollback-only database-owner reproduction: COMPLETED -> ON_HOLD succeeded and the project had zero lifecycle events. This is not an authenticated-user lifecycle bypass: that role's direct project UPDATE is revoked. It does limit claims that every database write obeys the lifecycle matrix and produces history, and leaves future privileged write paths exposed.

## Additional concurrency concern — code inspection only

The claimed universal client-before-project lock order is not universal. `update_project_details` locks only the project (`FOR UPDATE OF p`), and child mutation triggers lock the project after the child row is being updated. Share-link reactivation takes a project lock, whereas archive takes the project lock before updating share links. Concurrent archive/reactivation can therefore acquire these rows in opposite order and deadlock. This was not reproduced concurrently in this review; add a controlled parallel-session regression and standardize lock acquisition before calling it settled.

## Confirmed verification

- Unit tests: 30/30, exit 0.
- TypeScript and lint: exit 0.
- Lifecycle acceptance rerun: 74/74, exit 0. Run `muz98du8`; cleanup verified its clients, projects, lifecycle history, membership, MFA factor and auth user gone.
- Live migration history contains 20261008100000, 20261008110000 and 20261008120000.
- Both permanent-delete RPCs rejected password/TOTP AMR timestamps older than five minutes at the SQL boundary. This probe simulated stale verified-token claims through the database owner; it is not a real aged-session browser regression.
- Bypass probes in `.qa-priority7-probes.sql` ran inside transactions ending with ROLLBACK. No existing business rows were modified and no probe fixtures persisted. The output contained the successful delete/move probes, the retention loss, and the stale-reauth rejection messages.
- Ledger, Vera and browser suites were not rerun in this turn. The claimed latest 65/65, 87/87 and 8/8 totals and first-run history are not independently established by this review. The posted account also explicitly describes a first lifecycle run failure followed by a trigger fix.

## Specification and decision notes

Keep the proposed lifecycle matrix as a reasonable product recommendation, with explicit Owner acceptance recorded. Direct ACTIVE -> ARCHIVED is consistent with B05's archive-and-recreate remedy; ON_HOLD need not be a mandatory intermediate step. Reopening with a reason is useful, but is not explicitly confirmed by the spec's arrow notation.

Priority #7 is still partial for spec J: authorized project-scoped export/deletion requests and selective retention are unbuilt. Notes/tags invalidating approval contradict the explicit spec rule, even though the behavior predates this change. Generic archived-write errors and the unresolved stream error remain disclosed limitations.

The browser fixture teardown still supports soft deletion when audit foreign keys block hard deletion. A report must distinguish removal of business fixtures from retention of anonymized auth/audit records; "every run's data was cleaned up" should not imply all rows were physically removed without checking that run's report.

No application code, migrations, commits or deployment changed during this review. Only the review artifact and rollback probe script were added.
