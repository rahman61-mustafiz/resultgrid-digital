# Priority 10 independent review — 10 October 2026

Decision: partial; do not mark Priority 10 fully accepted yet. Standard report/version and list flows are improved. Failure handling still has gaps.

## Findings

1. **P2 — dashboard dependencies are not all guarded.** `src/app/(app)/dashboard/page.tsx:87` discards the workspace query error and can silently substitute Asia/Dhaka. Project-read failure also loses the selected project's timezone (`:114`). Money/profit depend on `projectsRes.ok`, but Target progress checks only `targetsRes.ok` (`:414`), so targets can be presented under a fallback reporting period with missing project context. Needs attention (`:484`) renders from partial project rows or disappears entirely when its inputs fail. Add dependency checks and explicit unavailable states; do not compute date-based figures when their required timezone could not be loaded.

   Reproduction: `node scripts/qa-priority10-review.mjs` injects a failed project query and successful target query into the actual server component. Output: `moneyUnavailable:true`, `targetRowStillShown:true`, `targetsUnavailable:false`, `attentionCardShown:false`. This is an isolated component probe, not a live database/browser fault injection.

2. **P2, conditional on server configuration — pagination assumes a 1,000-row response cap.** `src/lib/supabase/fetch-all.ts:26` treats any page shorter than 1,000 as EOF. With 1,500 matching rows and a server cap of 500, the probe returns `ok:true`, 500 rows, one request. It would silently omit matches and understate totals. The lower cap was simulated; this was not reproduced on the current dev database. Use returned count/range information or actual progress plus an empty-page check instead of this assumption, with bounded termination.

3. **P3 — exact limit is reported incorrectly.** Exactly 50,000 rows returns `ok:false` and `more than 50,000 rows`, without probing whether another row exists. This is a false unavailable state at the documented maximum. Probe for an extra row or use an exact count and correct the wording.

4. **Coverage statement needs correction.** The existing 61 unit tests cover the pagination helper's error/limit result, not the rendered dashboard unavailable states or the rendered 500-result notice. Searches and inspection found no unit assertions for these UI states. A separate live browser test was added for Leads; Exports/Reports over 500 and live dashboard query failures remain untested.

## Verified

- Independent unit run: 61/61; TypeScript and full lint clean. The initial unit attempt hit sandbox `spawn EPERM`; the permitted process run passed.
- Live dev migration history contains `20261010110000`; `client_share_links.report_rules_version` defaults to 2.
- Migration assigns pre-existing rows v1 before changing the insert default to v2. v1/v2 period and financial selection branches were inspected.
- Live snapshot function is security invoker; anon/authenticated execute privileges are false, service_role execute is true.
- Independent production browser suite: **28/28 passed (8.5 minutes)**, including new v2 weekly periods and legacy v1 behavior. A `destination stream closed early` server message appeared near the final auth-expiry test; no assertion failed. It was not independently reproduced or diagnosed, so it is recorded as an observation rather than a new blocker.
- Additional live Leads browser regression: **1/1 passed**, with 1,501 actual dev-database leads. The page displayed `Showing the first 500 of 1501 results`, rendered 500 entries, and found the last fixture when searching for it. This verifies the current dev response-cap configuration, not the simulated lower-cap scenario.
- Final live SQL: QA clients **0**, QA leads **0**, evidence Storage files **0**, Storage deletion queue **0**, dashboard preferences **0**, active extra-review users **0**. Suite cleanup reports also show run-scoped projects/memberships/MFA factors at zero. QA auth users were **soft-deleted**, with anonymized emails and old sign-ins rejected, because security audit rows retain references. Do not describe that as hard deletion of all QA auth/audit history.

## Scope and boundaries

No application behavior or schema was changed by this review. Added review report, read-only component/helper probes, and scoped browser regression tests/config. The browser test uses synthetic QA leads and a throwaway Owner; fixture IDs are generated before insertion and cleanup verification is batched to avoid oversized request URLs.

The first extra browser run reached all assertions but failed in cleanup verification: the existing helper's single `.in(id, 1501 IDs)` verification request exceeded request-size handling. SQL confirmed that run's leads were already deleted; its exact remaining QA Owner was separately cleaned up. The revised test guarantees Owner cleanup even if lead cleanup verification fails.

Ledger/Vera/lifecycle/evidence script totals quoted in the handoff were not independently rerun for this Priority 10 review. No production deployment was inspected. Git main has no commits. Nothing was committed or deployed by this review. No decision to defer Priority 11 was inferred, and Priority 12 was not started.
