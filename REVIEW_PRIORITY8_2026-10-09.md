# Priority 8 independent review — 9 October 2026

## Decision

Not fully accepted. Mobile write blocking works in the tested flows, but the promised sign-out exception fails in three authentication states. Fix this before marking Priority 8 complete.

## Medium: sign-out cannot run during enrollment, verification or lock

`src/proxy.ts:72` and `src/proxy.ts:81` redirect AAL1 requests to enrollment or verification; `src/proxy.ts:107` redirects locked sessions to `/lock`. These branches also process `/auth/sign-out`, so its POST handler never runs. Listing the route as mobile-writable only exempts it from the earlier device check.

Independent browser requests, with the same-origin headers required by the handler, reproduced:

| Session state | POST /auth/sign-out result |
|---|---|
| Password accepted, no enrolled TOTP | 307 to /setup/totp |
| Password accepted, TOTP verification pending | 307 to /login/verify |
| AAL2 session with rg_locked=1 | 307 to /lock |

The verification session remained on `/login/verify` on reload. Unlocking the locked session succeeded, and ordinary sign-out then succeeded. A cross-site logout request was rejected with 403.

Allow the dedicated sign-out route to reach its handler before these authentication-state redirects, preserving its origin checks. Add regression tests that expect successful logout from all three states rather than the observed redirects. This routing defect also applies to desktop sessions.

## Verification and limits

- Independently reran unit tests: 35/35. Typecheck and lint passed.
- Full production browser run: 19/19 passed in 7.3 minutes, comprising the original 13 tests and six temporary audit tests. The audit tests deliberately asserted the observed incorrect logout redirects to document the defect; their passing result does not make those redirects acceptable. The real five-minute stale-approval check passed.
- Reviewed device detection, the proxy allowlist, sign-out handler, disabled page fieldset, and workspace Server Actions. Mutating workspace actions call `assertEditingAllowed()` before their work.
- Original mobile tests passed: enrollment, views, UI-bypass write rejection with unchanged stored data, phone header variants, and ordinary sign-out.
- An additional action request sent through an allowed share path returned 200 without the view-only message; the answer remained unchanged. This does not establish that the second-layer guard executed. Keep isolated guard execution listed as unverified.
- Recovery email round trips were not exercised. No recovery messages were sent by this review.
- Header-based device classification is a disclosed product limitation. Desktop-mode/spoofed headers do not prove a permission bypass.
- Edit pages remaining accessible with disabled controls is consistent with the stated implementation.
- Database suites were not rerun because this change does not alter the database. The browser suite exercises actual application RPCs.

## Lifecycle acceptance attribution

`BUILD_READINESS_QUESTIONNAIRE.md:227` and the README attribute acceptance to Rana on 8 October, quoting “ok now go forward.” That statement is not present in the conversation available to this review. The earlier reviewer recommended the matrix but left acceptance to the user. Verify the source of the quoted acceptance before treating it as confirmed; this review does not grant acceptance on the user's behalf.

## Existing work still outside Priority 8

The spec J deletion-request workflow, generic archived-write errors, and historical creative-approval backfill limitations remain separate outstanding items. The recurring stream-close error still has no established cause.

No application code, migrations, commits or deployments were changed by this review. Temporary browser probes are removed after the run; the independent run log is `.qa-priority8-independent.log`.

All three browser fixtures reported zero remaining clients, projects, memberships and MFA factors. Audit-referenced test logins were soft-deleted and anonymized, with old credentials rejected. A subsequent read-only database query independently confirmed zero `Vera Wellness QA` clients, zero `Mobile View QA` projects and zero active original-address Playwright QA logins. This confirms the current state, not the historical method used to clean the builder's interrupted run.
