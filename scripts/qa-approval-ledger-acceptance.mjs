#!/usr/bin/env node
/**
 * Live acceptance run for the approval/version/invalidation ledger
 * (supabase/migrations/20260922110000_project_approval_events.sql and
 * 20260922120000_approval_ledger_hardening.sql).
 *
 * This is NOT a mocked unit test -- it runs against the real linked dev
 * Supabase project, through a real authenticated (password + TOTP, aal2)
 * session, exercising the same RLS policies, triggers, and RPC functions
 * the app itself uses. It creates a throwaway QA workspace member, client,
 * and project, walks the full lifecycle, and asserts on the resulting DB
 * state at every step: submit -> approve+export (bound to a snapshot,
 * with an approval note) -> invalidate via a questionnaire edit ->
 * invalidate via an evidence edit -> invalidate via a client-business edit
 * -> re-approve -> re-export -- plus negative tests confirming direct
 * writes to projects.readiness_status and project_approval_events are
 * actually rejected, not just discouraged by convention.
 *
 * Usage:
 *   node --env-file=.env.local scripts/qa-approval-ledger-acceptance.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, and a logged-in Supabase CLI linked to the
 * same project (the cleanup purge needs a direct database session). On
 * exit it removes everything this run created -- client, project, ledger,
 * exports, membership, MFA factor, auth user -- and verifies each removal;
 * see cleanup() below. Other runs' fixtures are never touched.
 */
import { createClient } from "@supabase/supabase-js"
import { createHmac, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

import { currentFingerprint, mustCount, purgeQaClients } from "./lib/qa-fixtures.mjs"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------
// RFC 4648 base32 decode + RFC 6238 TOTP, so this script can complete its
// own mandatory TOTP enrollment without a human at an authenticator app --
// this is a local HMAC computation from the secret Supabase issues us at
// enroll time, the same math any authenticator app does, not a bypass of
// the MFA requirement.
// ---------------------------------------------------------------------

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const clean = input.toUpperCase().replace(/=+$/, "")
  let bits = ""
  for (const char of clean) {
    const val = alphabet.indexOf(char)
    if (val === -1) throw new Error(`invalid base32 character: ${char}`)
    bits += val.toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function totpCode(base32Secret, timeStepSeconds = 30, digits = 6, atTime = Date.now()) {
  const key = base32Decode(base32Secret)
  const counter = Math.floor(atTime / 1000 / timeStepSeconds)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac("sha1", key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(truncated % 10 ** digits).padStart(digits, "0")
}

// ---------------------------------------------------------------------
// Assertion helpers -- collect failures instead of throwing on the first
// one, so a single run reports the full picture.
// ---------------------------------------------------------------------

const failures = []
let passCount = 0

function check(label, condition, detail) {
  if (condition) {
    passCount += 1
    console.log(`  PASS  ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`)
  }
}

/**
 * Verifies the call was rejected for the specific reason expected --
 * matching the PostgreSQL SQLSTATE code, not just "some error happened".
 * A prior version of this check passed on ANY thrown error, including
 * client-side/network failures that have nothing to do with the
 * privilege/RLS/trigger guarantee under test; that would have silently
 * passed even if the guarantee were completely missing, as long as the
 * call failed for an unrelated reason (or been silently miscounted if the
 * call actually succeeded but the SDK still threw for some other reason).
 * `expectedCodes`: PostgreSQL SQLSTATE codes that count as a pass --
 * 42501 = insufficient_privilege (revoked grant or RLS policy violation),
 * P0001 = raise_exception (our forbid_mutation() trigger, which raises
 * without an explicit SQLSTATE so it defaults to P0001).
 */
async function expectRejected(label, promise, expectedCodes) {
  try {
    const { error } = await promise
    if (!error) {
      check(label, false, "expected an error, got none")
      return
    }
    check(
      label,
      expectedCodes.includes(error.code),
      `expected SQLSTATE in [${expectedCodes.join(", ")}], got ${error.code}: ${error.message}`
    )
  } catch (err) {
    check(label, false, `unexpected thrown error, not a PostgREST error response: ${err?.message ?? err}`)
  }
}

// ---------------------------------------------------------------------
// Required question keys, parsed from the questionnaire source (plain
// regex, not a TS import -- this script runs as plain Node, no bundler).
// Cross-checked against a known count below.
// ---------------------------------------------------------------------

function loadRequiredQuestionKeys() {
  const src = readFileSync(
    new URL("../src/lib/questionnaire/v1.ts", import.meta.url),
    "utf8"
  )
  const entries = [
    // Question-level properties only (4-space indent): structured questions
    // also have field-level `required:` lines inside `fields: [...]`.
    ...src.matchAll(/^ {4}key: "([^"]+)",[\s\S]*?^ {4}required: (true|false),/gm),
  ]
  if (entries.length < 100) {
    throw new Error(
      `questionnaire parsing looks wrong: only found ${entries.length} question entries`
    )
  }
  return entries.filter((e) => e[2] === "true").map((e) => e[1])
}

// ---------------------------------------------------------------------
// Main run.
// ---------------------------------------------------------------------

const runId = Date.now().toString(36)
const qaEmail = `qa-ledger-acceptance-${runId}@resultgriddigital.internal`
const qaPassword = `Qa-${randomBytes(12).toString("hex")}!Aa1`

let qaUserId = null
let mfaFactorId = null
let clientBusinessId = null
let projectId = null

/**
 * Removes this run's fixtures, verifying each step with queries whose
 * errors are surfaced (a failed check never reads as "nothing left").
 *
 * The ledger and exports are immutable for every app role, so the run's
 * client/project are removed through purgeQaClients (scripts/lib/
 * qa-fixtures.mjs), which disables the delete guards inside one
 * transaction and is scoped to this run's client id AND the QA name
 * prefix. That runs first: with the ledger rows gone, nothing references
 * the auth user any more, so it can be hard-deleted.
 */
async function cleanup() {
  console.log("\nCleaning up this run's fixtures...")
  const cleanupFailures = []
  const attempt = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      cleanupFailures.push(`${label}: ${err?.message ?? err}`)
    }
  }

  if (clientBusinessId) {
    await attempt(`purge client ${clientBusinessId} and its project`, () =>
      purgeQaClients(admin, [clientBusinessId], "QA Ledger Acceptance ")
    )
  }

  if (qaUserId) {
    if (mfaFactorId) {
      await attempt(`MFA factor ${mfaFactorId}`, async () => {
        const { error } = await admin.auth.admin.mfa.deleteFactor({ id: mfaFactorId, userId: qaUserId })
        if (error) throw error
      })
    }
    await attempt("workspace membership", async () => {
      const { error } = await admin.from("workspace_members").delete().eq("user_id", qaUserId)
      if (error) throw error
      const left = await mustCount(
        admin.from("workspace_members").select("id", { count: "exact", head: true }).eq("user_id", qaUserId),
        "workspace_members after delete"
      )
      if (left !== 0) throw new Error(`${left} membership row(s) still present`)
    })
    await attempt(`auth user ${qaUserId}`, async () => {
      const { error } = await admin.auth.admin.deleteUser(qaUserId)
      if (error) throw new Error(`hard delete failed: ${error.message}`)
      const { data, error: lookupError } = await admin.auth.admin.getUserById(qaUserId)
      if (data?.user) throw new Error("still resolvable after deleteUser reported success")
      if (lookupError && lookupError.status !== 404) throw new Error(`could not verify deletion: ${lookupError.message}`)
    })
  }

  if (cleanupFailures.length > 0) {
    console.log("Cleanup INCOMPLETE:")
    for (const f of cleanupFailures) console.log(`  - ${f}`)
  } else {
    console.log("Cleanup verified: this run's client, project, ledger, exports, membership, MFA factor and auth user are all gone.")
  }
  return cleanupFailures
}

async function main() {
  console.log(`Approval ledger acceptance run ${runId}\n`)

  // --- Set up a throwaway QA Owner-role member ------------------------
  const { data: workspace } = await admin.from("workspaces").select("id").limit(1).single()
  if (!workspace) throw new Error("no workspace found -- run bootstrap-workspace.mjs first")

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email: qaEmail,
    password: qaPassword,
    email_confirm: true,
  })
  if (createUserError) throw createUserError
  qaUserId = createdUser.user.id

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: qaUserId,
    role: "OWNER",
  })
  if (memberError) throw memberError

  // --- Sign in and complete TOTP enrollment to reach aal2 --------------
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({
    email: qaEmail,
    password: qaPassword,
  })
  if (signInError) throw signInError

  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({
    factorType: "totp",
  })
  if (enrollError) throw enrollError
  mfaFactorId = enrollData.id

  const { data: challengeData, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrollData.id,
  })
  if (challengeError) throw challengeError

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollData.id,
    challengeId: challengeData.id,
    code: totpCode(enrollData.totp.secret),
  })
  if (verifyError) throw verifyError

  console.log("Signed in at aal2 as throwaway QA Owner member.\n")

  // --- Create a client/business and project -----------------------------
  const { data: clientBusiness, error: cbError } = await client
    .from("client_businesses")
    .insert({
      workspace_id: workspace.id,
      display_name: `QA Ledger Acceptance ${runId}`,
      record_type: "EXTERNAL_CLIENT",
      country: "Bangladesh",
      timezone: "Asia/Dhaka",
    })
    .select("id")
    .single()
  if (cbError) throw cbError
  clientBusinessId = clientBusiness.id

  const { data: project, error: projectError } = await client
    .from("projects")
    .insert({
      workspace_id: workspace.id,
      client_business_id: clientBusinessId,
      project_name: `QA Ledger Acceptance ${runId}`,
      project_type: "SEO",
      lifecycle_status: "ACTIVE",
      default_currency: "USD",
      timezone: "Asia/Dhaka",
    })
    .select("id, readiness_status")
    .single()
  if (projectError) throw projectError
  projectId = project.id

  check("new project starts INCOMPLETE", project.readiness_status === "INCOMPLETE")

  // --- Answer every required question -------------------------------
  // One upsert_project_answer RPC call per question -- direct writes to
  // project_answers are revoked for authenticated (see
  // supabase/migrations/20260922150000_atomic_mutation_invalidation.sql),
  // so this exercises the exact path saveAnswerAction uses, not a
  // shortcut bulk upsert. The project is INCOMPLETE for all of these, so
  // the RPC's invalidation branch never fires; p_next_readiness_status is
  // unused while that holds.
  const requiredKeys = loadRequiredQuestionKeys()
  for (const key of requiredKeys) {
    const { error } = await client.rpc("upsert_project_answer", {
      p_project_id: projectId,
      p_question_key: key,
      p_questionnaire_version: 1,
      p_status: "ANSWERED",
      p_value: `QA acceptance answer for ${key}`,
      p_next_readiness_status: "READY_FOR_REVIEW",
    })
    if (error) throw error
  }
  console.log(`Answered ${requiredKeys.length} required questions.\n`)

  // --- 0. Unknown question keys are rejected by the database itself ------
  // (supabase/migrations/20261007100000_reject_unknown_question_keys.sql)
  console.log("Step 0: upsert_project_answer rejects keys outside the questionnaire")
  for (const [label, key, version] of [
    ["made-up key", "E99.Q99", 1],
    ["valid key, unpublished questionnaire version", requiredKeys[0], 2],
  ]) {
    const { error: unknownKeyError } = await client.rpc("upsert_project_answer", {
      p_project_id: projectId,
      p_question_key: key,
      p_questionnaire_version: version,
      p_status: "ANSWERED",
      p_value: "should never be stored",
      p_next_readiness_status: "READY_FOR_REVIEW",
    })
    check(`${label} is rejected (22023)`, unknownKeyError?.code === "22023", unknownKeyError?.message ?? "no error")
  }
  const { count: strayRows, error: strayError } = await admin
    .from("project_answers")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .or("question_key.eq.E99.Q99,questionnaire_version.eq.2")
  check("no stray answer row was stored", !strayError && strayRows === 0, strayError?.message ?? `${strayRows} rows`)
  console.log()

  // --- 1. Submit for review ----------------------------------------------
  console.log("Step 1: submit_project_for_review")
  // Mark-ready is bound to the snapshot readiness was checked on
  // (20261007110000): an answer saved after that check makes it fail.
  const fingerprintBeforeEdit = await currentFingerprint(client, projectId)
  const { error: lateSaveError } = await client.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: requiredKeys[0],
    p_questionnaire_version: 1,
    p_status: "ANSWERED",
    p_value: "QA acceptance answer, saved after the readiness check",
    p_next_readiness_status: "READY_FOR_REVIEW",
  })
  check("an answer save after the readiness check succeeds", !lateSaveError, lateSaveError?.message)
  const { error: staleSubmitError } = await client.rpc("submit_project_for_review", {
    p_project_id: projectId,
    p_expected_fingerprint: fingerprintBeforeEdit,
  })
  check("submit with the pre-save fingerprint is rejected as stale (PT409)", staleSubmitError?.code === "PT409", staleSubmitError?.message ?? "no error")
  const { data: afterStaleSubmit } = await admin.from("projects").select("readiness_status").eq("id", projectId).single()
  check("the stale submit left the project INCOMPLETE", afterStaleSubmit?.readiness_status === "INCOMPLETE", afterStaleSubmit?.readiness_status)
  const { error: missingFingerprintError } = await client.rpc("submit_project_for_review", {
    p_project_id: projectId,
    p_expected_fingerprint: null,
  })
  check("submit without a fingerprint is rejected (PT409)", missingFingerprintError?.code === "PT409", missingFingerprintError?.message ?? "no error")

  const { error: submitError } = await client.rpc("submit_project_for_review", {
    p_project_id: projectId,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  check("submit RPC succeeds", !submitError, submitError?.message)

  let { data: afterSubmit } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check("status is READY_FOR_REVIEW after submit", afterSubmit?.readiness_status === "READY_FOR_REVIEW")

  let { data: events } = await client
    .from("project_approval_events")
    .select("event_type, from_status, to_status, actor_id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
  check(
    "ledger recorded SUBMITTED_FOR_REVIEW with actor set",
    events?.some((e) => e.event_type === "SUBMITTED_FOR_REVIEW" && e.actor_id === qaUserId)
  )

  // --- 2. Approve + export atomically, with an approval note -------------
  console.log("\nStep 2: approve_and_export_project")
  const { data: approveResult, error: approveError } = await client.rpc(
    "approve_and_export_project",
    {
      p_project_id: projectId,
      p_content: "# QA acceptance content v1",
      p_evidence_index_content: "# QA acceptance evidence index v1",
      p_export_manifest_content: "# QA acceptance manifest v1",
      p_expected_version: 1,
      p_expected_fingerprint: await currentFingerprint(client, projectId),
      p_approval_note: "QA acceptance run approval note.",
    }
  )
  check("approve+export RPC succeeds", !approveError, approveError?.message)
  check(
    "approve+export returned version 1",
    Array.isArray(approveResult) ? approveResult[0]?.export_version === 1 : approveResult?.export_version === 1
  )

  const { data: afterApprove } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check("status is APPROVED after approve", afterApprove?.readiness_status === "APPROVED")

  const { data: exportRow } = await client
    .from("project_exports")
    .select("version, content")
    .eq("project_id", projectId)
    .eq("version", 1)
    .maybeSingle()
  check(
    "immutable export snapshot v1 exists and matches approved content",
    exportRow?.content === "# QA acceptance content v1"
  )

  const { data: approvedEvent } = await client
    .from("project_approval_events")
    .select("export_version, reason, actor_id")
    .eq("project_id", projectId)
    .eq("event_type", "APPROVED")
    .maybeSingle()
  check(
    "APPROVED ledger event is bound to export_version 1",
    approvedEvent?.export_version === 1
  )
  check(
    "APPROVED ledger event carries the approval note",
    approvedEvent?.reason === "QA acceptance run approval note."
  )
  check("APPROVED ledger event has an actor", approvedEvent?.actor_id === qaUserId)

  // --- 3. Invalidate via a questionnaire answer edit, in ONE atomic call --
  // upsert_project_answer does the write AND the invalidation together --
  // no second RPC call, unlike the two-step
  // write-then-invalidate_project_approval pattern this replaced. See
  // supabase/migrations/20260922150000_atomic_mutation_invalidation.sql.
  console.log("\nStep 3: invalidate via questionnaire edit, atomically (blank a required answer)")
  const firstRequiredKey = requiredKeys[0]
  const { data: answersBeforeBlank } = await client
    .from("project_answers")
    .select("question_key, status, value")
    .eq("project_id", projectId)
  const projectedAfterBlank = new Map(
    (answersBeforeBlank ?? []).map((a) => [a.question_key, a])
  )
  projectedAfterBlank.set(firstRequiredKey, {
    question_key: firstRequiredKey,
    status: "UNANSWERED",
    value: null,
  })
  const stillComplete = !requiredKeys.some(
    (k) => (projectedAfterBlank.get(k)?.status ?? "UNANSWERED") === "UNANSWERED"
  )
  const { error: blankError } = await client.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: firstRequiredKey,
    p_questionnaire_version: 1,
    p_status: "UNANSWERED",
    p_value: null,
    p_next_readiness_status: stillComplete ? "READY_FOR_REVIEW" : "INCOMPLETE",
  })
  check("upsert_project_answer (blank) succeeds", !blankError, blankError?.message)

  const { data: afterInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "status dropped to INCOMPLETE after blanking a required answer, from the SAME call",
    afterInvalidate?.readiness_status === "INCOMPLETE"
  )

  const { data: invalidatedEvents } = await client
    .from("project_approval_events")
    .select("from_status, to_status, reason")
    .eq("project_id", projectId)
    .eq("event_type", "INVALIDATED")
  check(
    "ledger recorded an INVALIDATED APPROVED->INCOMPLETE event with a reason",
    invalidatedEvents?.some(
      (e) => e.from_status === "APPROVED" && e.to_status === "INCOMPLETE" && !!e.reason
    )
  )

  // Re-answer and get back to APPROVED with a second export version, so
  // the evidence/client invalidation steps below start from APPROVED.
  await client.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: firstRequiredKey,
    p_questionnaire_version: 1,
    p_status: "ANSWERED",
    p_value: "QA acceptance answer restored.",
    p_next_readiness_status: "READY_FOR_REVIEW",
  })
  await client.rpc("submit_project_for_review", {
    p_project_id: projectId,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  const { error: reapproveError } = await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v2",
    p_evidence_index_content: "# QA acceptance evidence index v2",
    p_export_manifest_content: "# QA acceptance manifest v2",
    p_expected_version: 2,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  check("re-approve after fixing the answer succeeds", !reapproveError, reapproveError?.message)

  // --- 4. Invalidate via a non-scored (evidence) edit, in ONE atomic call -
  console.log("\nStep 4: invalidate via evidence edit, atomically (non-scored)")
  const { error: evidenceError } = await client.rpc("add_evidence_item", {
    p_project_id: projectId,
    p_category: "evidence",
    p_external_url: "https://example.com/qa-acceptance-evidence",
    p_verification_status: "UNVERIFIED",
  })
  check("add_evidence_item succeeds", !evidenceError, evidenceError?.message)

  const { data: afterEvidenceInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after evidence edit, from the SAME call (not INCOMPLETE, since answers are still complete)",
    afterEvidenceInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  // Re-approve again (v3) so the client-level bulk invalidation test below
  // also starts from APPROVED.
  const { error: reapprove2Error } = await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v3",
    p_evidence_index_content: "# QA acceptance evidence index v3",
    p_export_manifest_content: "# QA acceptance manifest v3",
    p_expected_version: 3,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  check("second re-approve succeeds", !reapprove2Error, reapprove2Error?.message)

  // --- 5. Bulk invalidation via a client-business edit, in ONE atomic call
  console.log("\nStep 5: invalidate via client-business edit, atomically (bulk)")
  // Client fields the export isn't generated from don't invalidate (spec D).
  const { data: clientBeforeNotes } = await client.from("client_businesses").select("display_name").eq("id", clientBusinessId).single()
  const { error: clientNotesError } = await client.rpc("update_client_business_details", {
    p_client_business_id: clientBusinessId,
    p_display_name: clientBeforeNotes?.display_name,
    p_record_type: "EXTERNAL_CLIENT",
    p_country: "Bangladesh",
    p_timezone: "Asia/Dhaka",
    p_industry: "QA industry",
    p_internal_notes: "QA: client note edited after approval",
  })
  check("a client notes/industry-only edit succeeds", !clientNotesError, clientNotesError?.message)
  const { data: afterClientNotes } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("client notes edits keep the project APPROVED", afterClientNotes?.readiness_status === "APPROVED", afterClientNotes?.readiness_status)
  const { error: clientUpdateError } = await client.rpc("update_client_business_details", {
    p_client_business_id: clientBusinessId,
    p_display_name: `QA Ledger Acceptance ${runId} (edited)`,
    p_record_type: "EXTERNAL_CLIENT",
    p_country: "Bangladesh",
    p_timezone: "Asia/Dhaka",
  })
  check("update_client_business_details succeeds", !clientUpdateError, clientUpdateError?.message)

  const { data: afterClientInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after client-level edit, from the SAME call",
    afterClientInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  // --- 6. Re-export while APPROVED (record_project_export) -----------------
  console.log("\nStep 6: re-approve then record_project_export")
  await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v4",
    p_evidence_index_content: "# QA acceptance evidence index v4",
    p_export_manifest_content: "# QA acceptance manifest v4",
    p_expected_version: 4,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  const { data: freshExportResult, error: freshExportError } = await client.rpc(
    "record_project_export",
    {
      p_project_id: projectId,
      p_content: "# QA acceptance content v4",
      p_evidence_index_content: "# QA acceptance evidence index v4",
      p_export_manifest_content: "# QA acceptance manifest v4",
      p_expected_version: 5,
      p_expected_fingerprint: await currentFingerprint(client, projectId),
    }
  )
  check("record_project_export RPC succeeds", !freshExportError, freshExportError?.message)
  check(
    "record_project_export returned version 5 and status stayed APPROVED",
    Array.isArray(freshExportResult)
      ? freshExportResult[0]?.export_version === 5
      : freshExportResult?.export_version === 5
  )
  const { data: statusStillApproved } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check("status remained APPROVED after a plain re-export", statusStillApproved?.readiness_status === "APPROVED")

  // --- 7. Project-field edit invalidation, in ONE atomic call, using the --
  //         exact column set updateProjectAction
  //         (src/app/(app)/projects/actions.ts) sends -- proves the
  //         tightened column-level grants from
  //         20260922150000_atomic_mutation_invalidation.sql don't also
  //         block the app's own legitimate update.
  console.log("\nStep 7: project-field edit invalidation, atomically (update_project_details)")
  // Status is already APPROVED from Step 6's record_project_export (which
  // doesn't change it) -- no re-approval needed before editing fields.
  // Optional fields outside the export (notes, tags, description, dates)
  // don't invalidate the approval (spec D08).
  const { count: invalidationsBeforeNotes } = await client
    .from("project_approval_events")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("event_type", "INVALIDATED")
  const { error: notesOnlyError } = await client.rpc("update_project_details", {
    p_project_id: projectId,
    p_project_name: `QA Ledger Acceptance ${runId}`,
    p_project_type: "SEO",
    p_default_currency: "USD",
    p_export_language: "en",
    p_timezone: "Asia/Dhaka",
    p_start_date: "2026-11-01",
    p_short_description: "QA: description edited after approval",
    p_internal_notes: "QA: internal note edited after approval",
    p_tags: ["qa-tag"],
  })
  check("a notes/tags/description/start-date-only edit succeeds", !notesOnlyError, notesOnlyError?.message)
  const { data: afterNotesOnly } = await client.from("projects").select("readiness_status, internal_notes, tags").eq("id", projectId).single()
  const { count: invalidationsAfterNotes } = await client
    .from("project_approval_events")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("event_type", "INVALIDATED")
  check(
    "notes/tags edits keep the project APPROVED and record no invalidation",
    afterNotesOnly?.readiness_status === "APPROVED" &&
      afterNotesOnly?.internal_notes === "QA: internal note edited after approval" &&
      JSON.stringify(afterNotesOnly?.tags) === JSON.stringify(["qa-tag"]) &&
      invalidationsAfterNotes === invalidationsBeforeNotes,
    JSON.stringify({ afterNotesOnly, invalidationsBeforeNotes, invalidationsAfterNotes })
  )
  const { error: projectFieldUpdateError } = await client.rpc("update_project_details", {
    p_project_id: projectId,
    p_project_name: `QA Ledger Acceptance ${runId} (edited)`,
    p_project_type: "SEO",
    p_default_currency: "USD",
    p_export_language: "en",
    p_timezone: "Asia/Dhaka",
    p_tags: [],
  })
  check(
    "update_project_details (updateProjectAction's exact column set) succeeds",
    !projectFieldUpdateError,
    projectFieldUpdateError?.message
  )
  const { data: afterProjectFieldInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after a project-field edit, from the SAME call",
    afterProjectFieldInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  // --- 8. Atomicity proof: force the write half to fail, confirm NEITHER --
  //         half applied. If the mutation and invalidation weren't in one
  //         transaction, a failure partway could leave one applied without
  //         the other; this proves that can't happen.
  console.log("\nStep 8: atomicity -- a forced failure must apply NEITHER the write NOR the invalidation")
  const { error: setupApproveError } = await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v6",
    p_evidence_index_content: "# QA acceptance evidence index v6",
    p_export_manifest_content: "# QA acceptance manifest v6",
    p_expected_version: 6,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  check("approve before the atomicity-proof step succeeds", !setupApproveError, setupApproveError?.message)

  const { count: evidenceCountBefore } = await client
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  const { error: forcedEvidenceError } = await client.rpc("add_evidence_item", {
    p_project_id: projectId,
    // Violates evidence_items' category CHECK constraint -- the INSERT
    // itself fails, before add_evidence_item ever reaches its
    // if v_from_status = 'APPROVED' invalidation branch.
    p_category: "not_a_real_category",
    p_external_url: "https://example.com/qa-acceptance-should-not-be-created",
    p_verification_status: "UNVERIFIED",
  })
  check(
    "add_evidence_item with an invalid category is rejected",
    !!forcedEvidenceError,
    forcedEvidenceError ? undefined : "expected an error, got none"
  )
  const { count: evidenceCountAfter } = await client
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  check(
    "no evidence_items row was created by the failed call",
    evidenceCountBefore === evidenceCountAfter
  )
  const { data: statusAfterForcedEvidenceFailure } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "readiness_status stayed APPROVED -- the failed write did NOT still invalidate",
    statusAfterForcedEvidenceFailure?.readiness_status === "APPROVED"
  )

  const { data: answerBefore } = await client
    .from("project_answers")
    .select("status, value")
    .eq("project_id", projectId)
    .eq("question_key", firstRequiredKey)
    .single()
  const { error: forcedAnswerError } = await client.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: firstRequiredKey,
    p_questionnaire_version: 1,
    // Violates project_answers' status CHECK constraint.
    p_status: "NOT_A_REAL_STATUS",
    p_value: "should not be written",
    p_next_readiness_status: "INCOMPLETE",
  })
  check(
    "upsert_project_answer with an invalid status is rejected",
    !!forcedAnswerError,
    forcedAnswerError ? undefined : "expected an error, got none"
  )
  const { data: answerAfter } = await client
    .from("project_answers")
    .select("status, value")
    .eq("project_id", projectId)
    .eq("question_key", firstRequiredKey)
    .single()
  check(
    "the answer row was NOT changed by the failed call",
    answerAfter?.status === answerBefore?.status && answerAfter?.value === answerBefore?.value
  )
  const { data: statusAfterForcedAnswerFailure } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "readiness_status stayed APPROVED after the failed answer write too",
    statusAfterForcedAnswerFailure?.readiness_status === "APPROVED"
  )

  // --- 9. Financial records & targets: attribution rule + atomic --------
  //         invalidation (Priority #4). Project is APPROVED (v6) here,
  //         from Step 8's setup call.
  console.log("\nStep 9: financial record attribution rule + target/financial atomic invalidation")

  await expectRejected(
    "add_financial_record with attributed_to_marketing but UNVERIFIED evidence is rejected (DB constraint)",
    client.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: "CLIENT_OWN_REVENUE",
      p_amount: 500,
      p_value_status: "CONFIRMED",
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_evidence_status: "UNVERIFIED",
      p_attributed_to_marketing: true,
    }),
    ["23514"] // check_violation
  )
  await expectRejected(
    "add_financial_record with attributed_to_marketing on a non-revenue record type is rejected (DB constraint)",
    client.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: "MARKETING_SPEND",
      p_amount: 500,
      p_value_status: "CONFIRMED",
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_evidence_status: "VERIFIED",
      p_attributed_to_marketing: true,
    }),
    ["23514"]
  )

  const { data: spendRecord, error: spendError } = await client.rpc("add_financial_record", {
    p_project_id: projectId,
    p_record_type: "MARKETING_SPEND",
    p_amount: 250,
    p_value_status: "CONFIRMED",
    p_period_start: "2026-01-01",
    p_period_end: "2026-01-31",
    p_evidence_status: "OWNER_REPORTED",
  })
  check("add_financial_record (valid, non-attributed) succeeds", !spendError, spendError?.message)
  const { data: afterFinancialInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after a financial record was added, from the SAME call",
    afterFinancialInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v7",
    p_evidence_index_content: "# QA acceptance evidence index v7",
    p_export_manifest_content: "# QA acceptance manifest v7",
    p_expected_version: 7,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })

  const spendRecordId = Array.isArray(spendRecord) ? spendRecord[0]?.id : spendRecord?.id
  const { error: correctionError } = await client.rpc("correct_financial_record", {
    p_record_id: spendRecordId,
    p_project_id: projectId,
    p_new_amount: 300,
    p_reason: "QA acceptance: correcting spend amount.",
  })
  check("correct_financial_record succeeds", !correctionError, correctionError?.message)
  const { data: afterCorrectionInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after a financial correction, from the SAME call",
    afterCorrectionInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  // Tightened attribution constraint (20260923120000): evidence_status
  // alone is not enough -- OWNER_REPORTED with no evidence_url is not
  // real evidence and must still be rejected.
  await expectRejected(
    "add_financial_record with attributed_to_marketing, OWNER_REPORTED, but no evidence_url is rejected (DB constraint)",
    client.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: "CLIENT_OWN_REVENUE",
      p_amount: 500,
      p_value_status: "CONFIRMED",
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_evidence_status: "OWNER_REPORTED",
      p_attributed_to_marketing: true,
    }),
    ["23514"]
  )
  const { data: revenueRecord, error: revenueError } = await client.rpc("add_financial_record", {
    p_project_id: projectId,
    p_record_type: "CLIENT_OWN_REVENUE",
    p_amount: 800,
    p_value_status: "CONFIRMED",
    p_period_start: "2026-01-01",
    p_period_end: "2026-01-31",
    p_evidence_status: "VERIFIED",
    p_evidence_url: "https://example.com/qa-acceptance-revenue-evidence",
    p_attributed_to_marketing: true,
  })
  check(
    "add_financial_record with real evidence (status + url) and attribution succeeds",
    !revenueError,
    revenueError?.message
  )
  const revenueRecordId = Array.isArray(revenueRecord) ? revenueRecord[0]?.id : revenueRecord?.id

  await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v8",
    p_evidence_index_content: "# QA acceptance evidence index v8",
    p_export_manifest_content: "# QA acceptance manifest v8",
    p_expected_version: 8,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })

  // bulk_add_financial_records: not previously exercised by this script --
  // one call inserting several rows, invalidating exactly once even
  // though multiple rows were written.
  const { data: bulkCount, error: bulkError } = await client.rpc("bulk_add_financial_records", {
    p_project_id: projectId,
    p_records: [
      {
        record_type: "RESULTGRID_FEE",
        amount: 100,
        value_status: "CONFIRMED",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        evidence_status: "OWNER_REPORTED",
      },
      {
        record_type: "OTHER_CAMPAIGN_COST",
        amount: 20,
        value_status: "CONFIRMED",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        evidence_status: "OWNER_REPORTED",
      },
    ],
  })
  check("bulk_add_financial_records succeeds", !bulkError, bulkError?.message)
  check("bulk_add_financial_records reports inserting 2 rows", bulkCount === 2)
  const { data: afterBulkInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after a bulk import, from the SAME call",
    afterBulkInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )
  const { count: bulkRowCount } = await client
    .from("financial_records")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .in("record_type", ["RESULTGRID_FEE", "OTHER_CAMPAIGN_COST"])
  check("both bulk-imported rows are actually present", bulkRowCount === 2)

  await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v9",
    p_evidence_index_content: "# QA acceptance evidence index v9",
    p_export_manifest_content: "# QA acceptance manifest v9",
    p_expected_version: 9,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })

  // set_financial_record_attribution: the previously-missing supported
  // path for editing evidence/attribution on an EXISTING row (rather than
  // only at creation time).
  const { error: attributionEditError } = await client.rpc("set_financial_record_attribution", {
    p_record_id: revenueRecordId,
    p_project_id: projectId,
    p_evidence_status: "VERIFIED",
    p_evidence_url: "https://example.com/qa-acceptance-revenue-evidence-updated",
    p_attributed_to_marketing: true,
  })
  check(
    "set_financial_record_attribution succeeds on an existing record",
    !attributionEditError,
    attributionEditError?.message
  )
  const { data: afterAttributionEditInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after editing attribution/evidence, from the SAME call",
    afterAttributionEditInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v10",
    p_evidence_index_content: "# QA acceptance evidence index v10",
    p_export_manifest_content: "# QA acceptance manifest v10",
    p_expected_version: 10,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })

  const { data: newTarget, error: targetError } = await client.rpc("add_project_target", {
    p_project_id: projectId,
    p_metric: "LEADS",
    p_unit: "count",
    p_target: 10,
    p_period_start: "2026-01-01",
    p_period_end: "2026-01-31",
  })
  check("add_project_target succeeds", !targetError, targetError?.message)
  const { data: afterTargetInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after a target was added, from the SAME call",
    afterTargetInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# QA acceptance content v11",
    p_evidence_index_content: "# QA acceptance evidence index v11",
    p_export_manifest_content: "# QA acceptance manifest v11",
    p_expected_version: 11,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })

  const newTargetId = Array.isArray(newTarget) ? newTarget[0]?.id : newTarget?.id
  const { error: actualError } = await client.rpc("update_project_target_actual", {
    p_target_id: newTargetId,
    p_project_id: projectId,
    p_actual: 4,
  })
  check("update_project_target_actual succeeds", !actualError, actualError?.message)
  const { data: afterActualInvalidate } = await client
    .from("projects")
    .select("readiness_status")
    .eq("id", projectId)
    .single()
  check(
    "APPROVED dropped to READY_FOR_REVIEW after a target's actual value changed, from the SAME call",
    afterActualInvalidate?.readiness_status === "READY_FOR_REVIEW"
  )

  // Timezone is a required project and client field (spec D08), though not
  // an export input: changing it invalidates.
  const reapprove = (version) =>
    currentFingerprint(client, projectId).then((fingerprint) =>
      client.rpc("approve_and_export_project", {
        p_project_id: projectId,
        p_content: `# QA acceptance content v${version}`,
        p_evidence_index_content: `# QA acceptance evidence index v${version}`,
        p_export_manifest_content: `# QA acceptance manifest v${version}`,
        p_expected_version: version,
        p_expected_fingerprint: fingerprint,
      })
    )
  const { error: reapprove12Error } = await reapprove(12)
  check("re-approve before the timezone checks", !reapprove12Error, reapprove12Error?.message)
  const { data: projectNow } = await client.from("projects").select("project_name").eq("id", projectId).single()
  const { error: tzError } = await client.rpc("update_project_details", {
    p_project_id: projectId,
    p_project_name: projectNow?.project_name,
    p_project_type: "SEO",
    p_default_currency: "USD",
    p_export_language: "en",
    p_timezone: "Asia/Kolkata",
    p_tags: ["qa-tag"],
    p_internal_notes: "QA: internal note edited after approval",
  })
  check("a project timezone-only edit succeeds", !tzError, tzError?.message)
  const { data: afterTz } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("a project timezone change invalidates the approval", afterTz?.readiness_status === "READY_FOR_REVIEW", afterTz?.readiness_status)
  const { error: reapprove13Error } = await reapprove(13)
  check("re-approve before the client timezone check", !reapprove13Error, reapprove13Error?.message)
  const { data: clientNow } = await client.from("client_businesses").select("display_name").eq("id", clientBusinessId).single()
  const { error: clientTzError } = await client.rpc("update_client_business_details", {
    p_client_business_id: clientBusinessId,
    p_display_name: clientNow?.display_name,
    p_record_type: "EXTERNAL_CLIENT",
    p_country: "Bangladesh",
    p_timezone: "Asia/Kolkata",
    p_industry: "QA industry",
    p_internal_notes: "QA: client note edited after approval",
  })
  check("a client timezone-only edit succeeds", !clientTzError, clientTzError?.message)
  const { data: afterClientTz } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("a client timezone change invalidates the approval", afterClientTz?.readiness_status === "READY_FOR_REVIEW", afterClientTz?.readiness_status)

  // --- 10. Negative tests: direct writes must be rejected --------------------
  // 42501 = insufficient_privilege (a revoked grant, or an RLS policy with
  // no matching row/role). P0001 = raise_exception, what
  // private.forbid_mutation() raises when a trigger fires -- allowed too,
  // in case grants are ever loosened back to relying on the trigger alone.
  console.log("\nStep 10: negative tests -- direct writes must be rejected")
  await expectRejected(
    "direct UPDATE of projects.readiness_status is rejected (column privilege revoked)",
    client.from("projects").update({ readiness_status: "APPROVED" }).eq("id", projectId),
    ["42501"]
  )
  await expectRejected(
    "authenticated direct INSERT into project_approval_events is rejected (privilege revoked)",
    client.from("project_approval_events").insert({
      workspace_id: workspace.id,
      project_id: projectId,
      event_type: "APPROVED",
      from_status: "READY_FOR_REVIEW",
      to_status: "APPROVED",
      actor_id: qaUserId,
    }),
    ["42501"]
  )
  // service_role bypasses RLS entirely, so this specifically checks the
  // table-level grant revoke from 20260922140000 -- without it, this call
  // would silently succeed even though RLS-only defenses look sufficient
  // when tested only as an ordinary authenticated user.
  await expectRejected(
    "service_role direct INSERT into project_approval_events is rejected (grant revoked, not just RLS)",
    admin.from("project_approval_events").insert({
      workspace_id: workspace.id,
      project_id: projectId,
      event_type: "APPROVED",
      from_status: "READY_FOR_REVIEW",
      to_status: "APPROVED",
      actor_id: qaUserId,
    }),
    ["42501"]
  )
  await expectRejected(
    "service_role direct UPDATE of an existing project_approval_events row is rejected",
    admin
      .from("project_approval_events")
      .update({ reason: "tampered" })
      .eq("project_id", projectId)
      .limit(1),
    ["42501", "P0001"]
  )
  await expectRejected(
    "service_role direct DELETE of a project_exports row is rejected",
    admin.from("project_exports").delete().eq("project_id", projectId).eq("version", 1),
    ["42501", "P0001"]
  )
  await expectRejected(
    "authenticated direct INSERT into financial_records is rejected (privilege revoked)",
    client.from("financial_records").insert({
      workspace_id: workspace.id,
      project_id: projectId,
      record_type: "MARKETING_SPEND",
      amount: 1,
      period_start: "2026-01-01",
      period_end: "2026-01-31",
    }),
    ["42501"]
  )
  await expectRejected(
    "service_role direct INSERT into financial_records is rejected (grant revoked, not just RLS)",
    admin.from("financial_records").insert({
      workspace_id: workspace.id,
      project_id: projectId,
      record_type: "MARKETING_SPEND",
      amount: 1,
      period_start: "2026-01-01",
      period_end: "2026-01-31",
    }),
    ["42501"]
  )
  // TRUNCATE is not reachable through this script (or through the app):
  // PostgREST, which every supabase-js call here goes through, only
  // exposes SELECT/INSERT/UPDATE/DELETE and function calls -- there is no
  // REST operation that issues TRUNCATE. The only path to it is a direct
  // Postgres connection string, which this script does not have and the
  // app never uses. That revoke (and the belt-and-suspenders statement-
  // level trigger) is verified by inspecting live grants instead:
  //   npx supabase db query --linked "select grantee, privilege_type
  //     from information_schema.table_privileges where table_name =
  //     'project_approval_events' and privilege_type = 'TRUNCATE'"
  // must return zero rows for anon/authenticated/service_role -- checked
  // manually as part of this ledger's acceptance sign-off, alongside this
  // script's automated checks below.

  // anon (unauthenticated) must not even be able to call the RPCs --
  // their internal is_workspace_owner() check would deny them anyway, but
  // EXECUTE should be revoked at the grant level too (Supabase security
  // advisor finding), not left as "callable but always denied inside".
  const anonClient = createClient(SUPABASE_URL, ANON_KEY)
  await expectRejected(
    "anon EXECUTE of submit_project_for_review is rejected (EXECUTE revoked from PUBLIC/anon)",
    anonClient.rpc("submit_project_for_review", { p_project_id: projectId, p_expected_fingerprint: "x" }),
    ["42501"]
  )

  // --- Summary ----------------------------------------------------------
  console.log(`\n${passCount} passed, ${failures.length} failed.`)
  if (failures.length > 0) {
    console.log("\nFailed checks:")
    for (const f of failures) console.log(`  - ${f}`)
  }
}

main()
  .then(async () => {
    const cleanupFailures = await cleanup()
    if (failures.length > 0 || cleanupFailures.length > 0) {
      console.log(
        `\nExiting non-zero: ${failures.length} check failure(s), ${cleanupFailures.length} cleanup failure(s).`
      )
      process.exit(1)
    }
    process.exit(0)
  })
  .catch(async (err) => {
    console.error("\nAcceptance run crashed:", err)
    const cleanupFailures = await cleanup()
    if (cleanupFailures.length > 0) {
      console.log(`Also had ${cleanupFailures.length} cleanup failure(s) on top of the crash.`)
    }
    process.exit(1)
  })
