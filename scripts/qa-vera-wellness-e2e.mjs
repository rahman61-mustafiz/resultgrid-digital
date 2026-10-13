#!/usr/bin/env node
/**
 * Vera Wellness DB-integration acceptance run for the demo flow in
 * SEED_PROJECT_RESULTGRID_DIGITAL.md's "MVP acceptance seed": Owner access
 * (password + TOTP), client/project setup, full Questionnaire V1 answer +
 * approval, all 7 financial record categories, targets, evidence, the
 * client report COMPUTATION (profit/targets/period filtering/internal-data
 * exclusion), a lock-forced edit + re-approval during an in-flight report
 * read (deterministic regression for get_client_report_snapshot), share-link
 * PIN/lockout/nonce LOGIC, and export version storage.
 * Runs against the real linked dev Supabase project through a real aal2
 * session. "Vera Wellness" is a synthetic fixture name, never real data.
 *
 * This is NOT full application E2E. Server-only modules (buildClientReport,
 * the share Server Actions, the export generator) can't be imported into
 * plain Node, so their pure logic is reimplemented here as faithful copies
 * and driven against real rows. The rendered pages, the PinForm over HTTP,
 * real cookies, and the real Markdown generator/ZIP are covered by the
 * Playwright suite in e2e/, not here.
 *
 * Usage:
 *   node --env-file=.env.local scripts/qa-vera-wellness-e2e.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, and a logged-in Supabase CLI linked to the
 * same project (used for the lock-based tests and the cleanup purge). On
 * exit it removes everything this run created and verifies each removal;
 * other runs' fixtures are never touched.
 */
import { createClient } from "@supabase/supabase-js"
import { spawn } from "node:child_process"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
// TOTP, same as qa-approval-ledger-acceptance.mjs -- see that file for
// why a local RFC 6238 computation is legitimate here (it completes the
// script's own mandatory enrollment, not a bypass of anyone else's).
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
// Share-link primitives -- reimplemented from src/lib/domain/share-link.ts
// (that module has no framework dependency; this is a faithful copy, not
// a divergent reimplementation, so a mismatch there would show up here as
// a genuine bug, not a script quirk).
// ---------------------------------------------------------------------

const SHARE_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60
const SHARE_PIN_MAX_ATTEMPTS = 5
const SHARE_PIN_LOCKOUT_SECONDS = 15 * 60
const DEFAULT_SHARE_LINK_EXPIRY_DAYS = 2

function generateShareToken() {
  return randomBytes(24).toString("base64url")
}
function generateSessionNonce() {
  return randomBytes(32).toString("base64url")
}
function hashSessionNonce(nonce) {
  return createHash("sha256").update(nonce).digest("hex")
}
function hashPin(pin, token) {
  return createHash("sha256").update(`${pin}:${token}`).digest("hex")
}
function isSessionNonceValid(presentedNonce, sessionNonceHash, sessionNonceExpiresAt) {
  return (
    !!presentedNonce &&
    !!sessionNonceHash &&
    !!sessionNonceExpiresAt &&
    new Date(sessionNonceExpiresAt).getTime() > Date.now() &&
    hashSessionNonce(presentedNonce) === sessionNonceHash
  )
}

/**
 * A faithful reimplementation of src/app/share/[token]/actions.ts's
 * verifySharePinAction control flow (same branch order: link validity,
 * then lockout, then PIN match, then success), operating on a plain
 * in-memory `link` row instead of cookies()/DB writes. Driving the PIN
 * section of this script through ONE function that mirrors the real
 * branch order -- rather than hand-asserting on timestamps at each step
 * -- is what lets a check like "correct PIN is blocked while locked out"
 * actually mean what it says: the correct PIN is passed in, and the
 * function's own lockout branch (not a side calculation in the test) is
 * what rejects it before ever reaching the comparison.
 *
 * Returns { outcome, link } where link is the row state AFTER applying
 * this attempt's DB write (matching what verifySharePinAction persists),
 * and `outcome` is one of: "UNAVAILABLE", "LOCKED", "WRONG_PIN", "OK".
 */
function simulateVerifySharePinAction(pin, token, link) {
  if (!link || link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) {
    return { outcome: "UNAVAILABLE", link }
  }
  if (link.locked_until && new Date(link.locked_until).getTime() > Date.now()) {
    return { outcome: "LOCKED", link }
  }
  if (hashPin(pin, token) !== link.pin_hash) {
    const attempts = link.failed_pin_attempts + 1
    const lockedOut = attempts >= SHARE_PIN_MAX_ATTEMPTS
    return {
      outcome: "WRONG_PIN",
      link: {
        ...link,
        failed_pin_attempts: lockedOut ? 0 : attempts,
        locked_until: lockedOut ? new Date(Date.now() + SHARE_PIN_LOCKOUT_SECONDS * 1000).toISOString() : null,
      },
      lockedOutByThisAttempt: lockedOut,
    }
  }
  const nonce = generateSessionNonce()
  return {
    outcome: "OK",
    nonce,
    link: {
      ...link,
      session_nonce_hash: hashSessionNonce(nonce),
      session_nonce_expires_at: new Date(Date.now() + SHARE_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
      failed_pin_attempts: 0,
      locked_until: null,
    },
  }
}

// ---------------------------------------------------------------------
// Financial/target computation, reimplemented from src/lib/finance/profit.ts
// and src/lib/reports/period.ts (both plain functions with only type-level,
// not runtime, framework dependencies -- this is a faithful copy of the
// exact logic buildClientReport calls, not a divergent approximation).
// ---------------------------------------------------------------------

function summarizeCategory(records, type) {
  const matching = records.filter((r) => r.record_type === type)
  let sum = 0
  let pendingCount = 0
  let disputedCount = 0
  for (const r of matching) {
    switch (r.value_status) {
      case "CONFIRMED":
      case "ESTIMATED":
        sum += r.amount
        break
      case "REFUNDED":
        sum -= r.amount
        break
      case "PENDING":
        pendingCount += 1
        break
      case "DISPUTED":
        disputedCount += 1
        break
    }
  }
  return { sum, hasAnyRecord: matching.length > 0, pendingCount, disputedCount }
}

function computeClientProfit(records) {
  const attributedRevenueRecords = records.filter(
    (r) => r.record_type === "CLIENT_OWN_REVENUE" && r.attributed_to_marketing
  )
  const revenue = summarizeCategory(attributedRevenueRecords, "CLIENT_OWN_REVENUE")
  const spend = summarizeCategory(records, "MARKETING_SPEND")
  const fee = summarizeCategory(records, "RESULTGRID_FEE")
  const other = summarizeCategory(records, "OTHER_CAMPAIGN_COST")

  const missing = []
  if (!revenue.hasAnyRecord) missing.push("CLIENT_OWN_REVENUE")
  if (!spend.hasAnyRecord) missing.push("MARKETING_SPEND")
  if (!fee.hasAnyRecord) missing.push("RESULTGRID_FEE")
  if (missing.length > 0) return { status: "INCOMPLETE", missingCategories: missing }

  return { status: "COMPLETE", amount: revenue.sum - spend.sum - fee.sum - other.sum }
}

function computeResultGridProfit(records) {
  const payment = summarizeCategory(records, "CLIENT_PAYMENT_RECEIVED")
  const delivery = summarizeCategory(records, "DIRECT_DELIVERY_COST")
  const operating = summarizeCategory(records, "ALLOCATED_OPERATING_COST")
  if (!payment.hasAnyRecord) return { status: "INCOMPLETE", missingCategories: ["CLIENT_PAYMENT_RECEIVED"] }
  return { status: "COMPLETE", amount: payment.sum - delivery.sum - operating.sum }
}

function pad(n) {
  return String(n).padStart(2, "0")
}
function toDateString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function resolveReportPeriodRange(key, now) {
  const year = now.getFullYear()
  const month = now.getMonth()
  switch (key) {
    case "all":
      return null
    case "this_month":
      return { start: toDateString(new Date(year, month, 1)), end: toDateString(new Date(year, month + 1, 0)) }
    case "this_year":
      return { start: `${year}-01-01`, end: `${year}-12-31` }
    default:
      throw new Error(`unhandled period key in this script's reimplementation: ${key}`)
  }
}
function periodsOverlap(aStart, aEnd, bStart, bEnd) {
  return aEnd >= bStart && aStart <= bEnd
}

// ---------------------------------------------------------------------
// Assertion helpers, same contract as the ledger acceptance script.
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

// ---------------------------------------------------------------------
// Questionnaire keys, parsed from source -- same technique as the ledger
// script, extended to answer BOTH required and optional questions (the
// real demo journey fills in everything it can, not just the minimum).
// ---------------------------------------------------------------------

function loadAllQuestionKeys() {
  const src = readFileSync(new URL("../src/lib/questionnaire/v1.ts", import.meta.url), "utf8")
  // Question-level properties only (4-space indent): structured questions
  // also have field-level `required:` lines inside `fields: [...]`.
  const entries = [...src.matchAll(/^ {4}key: "([^"]+)",[\s\S]*?^ {4}required: (true|false),/gm)]
  if (entries.length < 100) {
    throw new Error(`questionnaire parsing looks wrong: only found ${entries.length} question entries`)
  }
  return {
    all: entries.map((e) => e[1]),
    required: entries.filter((e) => e[2] === "true").map((e) => e[1]),
  }
}

// ---------------------------------------------------------------------
// Main run.
// ---------------------------------------------------------------------

const runId = Date.now().toString(36)
const qaEmail = `qa-vera-wellness-e2e-${runId}@resultgriddigital.internal`
const qaPassword = `Qa-${randomBytes(12).toString("hex")}!Aa1`

let qaUserId = null
let mfaFactorId = null
let clientBusinessId = null
let projectId = null
let shareLinkId = null

async function projectStatus() {
  const { data, error } = await admin.from("projects").select("readiness_status").eq("id", projectId).single()
  if (error) throw new Error(`could not read project status: ${error.message}`)
  return data.readiness_status
}

/**
 * Runs `holdSql` in a separate database session (via the Supabase CLI),
 * then takes ACCESS EXCLUSIVE on project_targets and sleeps, keeping the
 * transaction open. Returns once that lock is observably held.
 *
 * "Held" is proven, not assumed: a baseline read of project_targets must
 * succeed before the session starts, and afterwards only a client-side
 * timeout (the read is blocked) counts. Any other probe error fails.
 * PostgREST's authenticator role has statement_timeout = 8s, so the hold
 * stays well under that.
 */
async function startLockHolder(label, holdSql, holdSeconds = 6) {
  const probe = (ms) =>
    admin.from("project_targets").select("id").limit(1).abortSignal(AbortSignal.timeout(ms))

  const { error: baselineError } = await probe(5000)
  if (baselineError) {
    return { held: false, reason: `baseline probe failed before ${label}: ${baselineError.message}`, done: Promise.resolve() }
  }

  const sqlPath = join(tmpdir(), `rg-lock-${runId}-${Date.now()}.sql`)
  writeFileSync(
    sqlPath,
    `begin; ${holdSql} lock table public.project_targets in access exclusive mode; select pg_sleep(${holdSeconds}); commit;`
  )
  const holder = spawn("npx", ["supabase", "db", "query", "--linked", "-f", sqlPath], { shell: true, stdio: "ignore" })
  const done = new Promise((resolve) => holder.on("exit", resolve)).then(() => unlinkSync(sqlPath))

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const { error } = await probe(1500)
    if (!error) {
      await new Promise((r) => setTimeout(r, 300))
      continue
    }
    if (/^(TimeoutError|AbortError)\b/.test(error.message)) return { held: true, done }
    return { held: false, reason: `probe failed for a reason other than the lock: ${error.message}`, done }
  }
  return { held: false, reason: "lock was not observed within 60s", done }
}

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

  // Fixtures first: once this run's ledger rows are gone, nothing pins the
  // auth user, so it can be hard-deleted below.
  if (clientBusinessId) {
    await attempt(`purge client ${clientBusinessId} and its project`, () =>
      purgeQaClients(admin, [clientBusinessId], "Vera Wellness QA ")
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
    console.log("Cleanup verified: this run's client, project, ledger, exports, share link, membership, MFA factor and auth user are all gone.")
  }
  return cleanupFailures
}

async function main() {
  console.log(`Vera Wellness E2E acceptance run ${runId}\n`)

  // --- Owner access: throwaway QA Owner member, password + TOTP to aal2 --
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

  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({ email: qaEmail, password: qaPassword })
  if (signInError) throw signInError

  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp" })
  if (enrollError) throw enrollError
  mfaFactorId = enrollData.id

  const { data: challengeData, error: challengeError } = await client.auth.mfa.challenge({ factorId: enrollData.id })
  if (challengeError) throw challengeError

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollData.id,
    challengeId: challengeData.id,
    code: totpCode(enrollData.totp.secret),
  })
  if (verifyError) throw verifyError

  console.log("Step 1: Owner signed in at aal2 (password + TOTP) as throwaway QA Owner member.\n")
  check("session reached aal2", true)

  // --- Client/business + project setup -----------------------------------
  console.log("Step 2: client/business and project setup")
  const { data: clientBusiness, error: cbError } = await client
    .from("client_businesses")
    .insert({
      workspace_id: workspace.id,
      display_name: `Vera Wellness QA ${runId}`,
      record_type: "EXTERNAL_CLIENT",
      country: "Bangladesh",
      timezone: "Asia/Dhaka",
    })
    .select("id")
    .single()
  check("client_business created", !cbError, cbError?.message)
  clientBusinessId = clientBusiness.id

  const { data: project, error: projectError } = await client
    .from("projects")
    .insert({
      workspace_id: workspace.id,
      client_business_id: clientBusinessId,
      project_name: `Vera Wellness Launch QA ${runId}`,
      project_type: "FULL_DIGITAL_MARKETING",
      lifecycle_status: "ACTIVE",
      default_currency: "BDT",
      timezone: "Asia/Dhaka",
    })
    .select("id, readiness_status")
    .single()
  check("project created", !projectError, projectError?.message)
  check("new project starts INCOMPLETE", project?.readiness_status === "INCOMPLETE")
  projectId = project.id

  // --- Questionnaire V1: answer every question, required and optional ----
  console.log("\nStep 3: Questionnaire V1 -- answer every question (required + optional)")
  const { all: allKeys, required: requiredKeys } = loadAllQuestionKeys()
  for (const key of allKeys) {
    const { error } = await client.rpc("upsert_project_answer", {
      p_project_id: projectId,
      p_question_key: key,
      p_questionnaire_version: 1,
      p_status: "ANSWERED",
      p_value: `Vera Wellness QA answer for ${key}`,
      p_next_readiness_status: "READY_FOR_REVIEW",
    })
    if (error) throw new Error(`upsert_project_answer(${key}) failed: ${error.message}`)
  }
  check(`answered all ${allKeys.length} questions (${requiredKeys.length} required)`, true)

  const { data: answerRows } = await client
    .from("project_answers")
    .select("question_key", { count: "exact", head: false })
    .eq("project_id", projectId)
  check("every required question has a stored answer row", requiredKeys.every((k) => answerRows?.some((a) => a.question_key === k)))

  // --- Evidence indexing (before submit, so it's part of the approved baseline) --
  console.log("\nStep 4: evidence indexing")
  const evidenceInputs = [
    { category: "seo", url: "https://example.com/vera-wellness-qa-gbp-screenshot" },
    { category: "evidence", url: "https://example.com/vera-wellness-qa-search-console-export" },
  ]
  for (const e of evidenceInputs) {
    const { error } = await client.rpc("add_evidence_item", {
      p_project_id: projectId,
      p_category: e.category,
      p_external_url: e.url,
      p_verification_status: "OWNER_REPORTED",
    })
    check(`add_evidence_item (${e.category}) succeeds`, !error, error?.message)
  }
  const { count: evidenceCount } = await client
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  check("both evidence items are present", evidenceCount === evidenceInputs.length)

  // --- Submit for review, then approve + export (v1) ----------------------
  console.log("\nStep 5: submit for review, approve + export (v1)")
  const { error: submitError } = await client.rpc("submit_project_for_review", {
    p_project_id: projectId,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
  })
  check("submit_project_for_review succeeds", !submitError, submitError?.message)
  const { data: afterSubmit } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("status is READY_FOR_REVIEW after submit", afterSubmit?.readiness_status === "READY_FOR_REVIEW")

  const { data: approveResult, error: approveError } = await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# Vera Wellness -- Project Context (QA v1)",
    p_evidence_index_content: "# Vera Wellness -- Evidence Index (QA v1)",
    p_export_manifest_content: "# Vera Wellness -- Export Manifest (QA v1)",
    p_expected_version: 1,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
    p_approval_note: "Vera Wellness QA e2e run: initial approval.",
  })
  check("approve_and_export_project (v1) succeeds", !approveError, approveError?.message)
  const exportVersion1 = Array.isArray(approveResult) ? approveResult[0]?.export_version : approveResult?.export_version
  check("first export is version 1", exportVersion1 === 1)
  const { data: afterApprove } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("status is APPROVED after first approval", afterApprove?.readiness_status === "APPROVED")

  // --- Financial entry: all 7 record categories ---------------------------
  console.log("\nStep 6: financial entry across all 7 record categories")
  const financialInputs = [
    { record_type: "CLIENT_PAYMENT_RECEIVED", amount: 60000, evidence_status: "OWNER_REPORTED" },
    {
      record_type: "CLIENT_OWN_REVENUE",
      amount: 150000,
      evidence_status: "VERIFIED",
      evidence_url: "https://example.com/vera-wellness-qa-booking-report",
      attributed_to_marketing: true,
    },
    { record_type: "MARKETING_SPEND", amount: 15000, evidence_status: "OWNER_REPORTED" },
    { record_type: "RESULTGRID_FEE", amount: 40000, evidence_status: "OWNER_REPORTED" },
    { record_type: "DIRECT_DELIVERY_COST", amount: 5000, evidence_status: "OWNER_REPORTED" },
    { record_type: "ALLOCATED_OPERATING_COST", amount: 3000, evidence_status: "OWNER_REPORTED" },
    { record_type: "OTHER_CAMPAIGN_COST", amount: 2000, evidence_status: "OWNER_REPORTED" },
  ]
  const financialRecordIds = {}
  for (const f of financialInputs) {
    const { data, error } = await client.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: f.record_type,
      p_amount: f.amount,
      p_value_status: "CONFIRMED",
      p_period_start: "2026-11-01",
      p_period_end: "2026-11-30",
      p_evidence_status: f.evidence_status,
      p_evidence_url: f.evidence_url,
      p_attributed_to_marketing: f.attributed_to_marketing ?? false,
    })
    check(`add_financial_record (${f.record_type}) succeeds`, !error, error?.message)
    financialRecordIds[f.record_type] = Array.isArray(data) ? data[0]?.id : data?.id
  }
  const { count: financialCount } = await client
    .from("financial_records")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  check("all 7 financial record categories are present", financialCount === financialInputs.length)
  const { data: afterFinancials } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("APPROVED was invalidated by the financial entries (atomic write+invalidate)", afterFinancials?.readiness_status === "READY_FOR_REVIEW")

  // --- Targets: add + record actuals for a representative set -------------
  console.log("\nStep 7: targets and target-vs-actual")
  const targetInputs = [
    { metric: "PAYING_CLIENTS", unit: "count", target: 3, actual: 1 },
    { metric: "LEADS", unit: "count", target: 30, actual: 12 },
    { metric: "REVENUE", unit: "BDT", target: 200000, actual: 150000 },
  ]
  for (const t of targetInputs) {
    const { data, error } = await client.rpc("add_project_target", {
      p_project_id: projectId,
      p_metric: t.metric,
      p_unit: t.unit,
      p_target: t.target,
      p_period_start: "2026-11-01",
      p_period_end: "2026-11-30",
    })
    check(`add_project_target (${t.metric}) succeeds`, !error, error?.message)
    const targetId = Array.isArray(data) ? data[0]?.id : data?.id
    const { error: actualError } = await client.rpc("update_project_target_actual", {
      p_target_id: targetId,
      p_project_id: projectId,
      p_actual: t.actual,
    })
    check(`update_project_target_actual (${t.metric}) succeeds`, !actualError, actualError?.message)
  }
  const { count: targetCount } = await client
    .from("project_targets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  check("all 3 targets are present", targetCount === targetInputs.length)

  // --- Re-approve + re-export (v2), now with financials/targets/evidence --
  console.log("\nStep 8: re-approve + re-export (v2) with the full dataset")
  const { data: approve2Result, error: approve2Error } = await client.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: "# Vera Wellness -- Project Context (QA v2, full dataset)",
    p_evidence_index_content: "# Vera Wellness -- Evidence Index (QA v2)",
    p_export_manifest_content: "# Vera Wellness -- Export Manifest (QA v2)",
    p_expected_version: 2,
    p_expected_fingerprint: await currentFingerprint(client, projectId),
    p_approval_note: "Vera Wellness QA e2e run: re-approval with financials/targets/evidence.",
  })
  check("approve_and_export_project (v2) succeeds", !approve2Error, approve2Error?.message)
  const exportVersion2 = Array.isArray(approve2Result) ? approve2Result[0]?.export_version : approve2Result?.export_version
  check("second export is version 2", exportVersion2 === 2)
  const { data: afterApprove2 } = await client.from("projects").select("readiness_status").eq("id", projectId).single()
  check("status is APPROVED again", afterApprove2?.readiness_status === "APPROVED")

  const { data: exportRow2 } = await client
    .from("project_exports")
    .select("content, evidence_index_content, export_manifest_content")
    .eq("project_id", projectId)
    .eq("version", 2)
    .maybeSingle()
  check("export snapshot v2: PROJECT_CONTEXT content stored exactly as approved", exportRow2?.content === "# Vera Wellness -- Project Context (QA v2, full dataset)")
  check("export snapshot v2: EVIDENCE_INDEX content stored exactly as approved", exportRow2?.evidence_index_content === "# Vera Wellness -- Evidence Index (QA v2)")
  check("export snapshot v2: EXPORT_MANIFEST content stored exactly as approved", exportRow2?.export_manifest_content === "# Vera Wellness -- Export Manifest (QA v2)")

  // --- Report computation: buildClientReport's selects + the same pure ---
  //     functions it calls (computeClientProfit, period filtering, target
  //     mapping), reimplemented above. This checks the COMPUTATION, not the
  //     rendered page -- see the closing note for what remains untested.
  console.log("\nStep 9: client report computation (profit, targets, period filtering, internal-data exclusion)")

  // Same single read buildClientReport now uses (get_client_report_snapshot),
  // then the same period filter / profit / target-cap logic.
  async function buildReportLikeClientReport(periodKey) {
    const { data: snapshot, error } = await admin.rpc("get_client_report_snapshot", { p_project_id: projectId })
    if (error) throw new Error(`get_client_report_snapshot failed: ${error.message}`)
    if (snapshot.readiness_status !== "APPROVED") {
      return { ok: false, reason: "NOT_APPROVED" }
    }
    const range = resolveReportPeriodRange(periodKey, new Date())
    const inPeriod = (r) => !range || periodsOverlap(r.period_start, r.period_end, range.start, range.end)
    return {
      ok: true,
      allFinancialRows: snapshot.financials,
      report: {
        profit: computeClientProfit(snapshot.financials.filter(inPeriod)),
        targets: snapshot.targets.filter(inPeriod).slice(0, 20),
      },
    }
  }

  // 150000 attributed revenue - 15000 spend - 40000 RGD fee - 2000 other = 93000
  const allTime = await buildReportLikeClientReport("all")
  check("report (all time) is available while APPROVED", allTime.ok)
  check(
    "client profit (all time) is COMPLETE and equals 150000 - 15000 - 40000 - 2000 = 93000",
    allTime.ok && allTime.report.profit.status === "COMPLETE" && allTime.report.profit.amount === 93000,
    allTime.ok ? JSON.stringify(allTime.report.profit) : undefined
  )
  check(
    "all 3 targets appear with the actuals that were recorded (1, 12, 150000)",
    allTime.ok &&
      allTime.report.targets.length === 3 &&
      allTime.report.targets.find((t) => t.metric === "PAYING_CLIENTS")?.actual === 1 &&
      allTime.report.targets.find((t) => t.metric === "LEADS")?.actual === 12 &&
      allTime.report.targets.find((t) => t.metric === "REVENUE")?.actual === 150000
  )

  // Internal-data exclusion: ResultGrid Digital's OWN profit uses a
  // different formula over different categories (payment received,
  // delivery cost, operating cost). The client report must carry only the
  // client-view figure -- never RGD's margin, and no field from which
  // RGD's internal categories could be read back.
  const rgdProfit = allTime.ok ? computeResultGridProfit(allTime.allFinancialRows) : null
  check(
    "ResultGrid Digital's internal profit (60000 - 5000 - 3000 = 52000) differs from the client figure",
    rgdProfit?.status === "COMPLETE" && rgdProfit.amount === 52000 && rgdProfit.amount !== 93000
  )
  const reportJson = allTime.ok ? JSON.stringify(allTime.report) : ""
  check(
    "the client report object exposes only { profit, targets } -- no internal-category keys or RGD margin",
    allTime.ok &&
      Object.keys(allTime.report).sort().join(",") === "profit,targets" &&
      !reportJson.includes("CLIENT_PAYMENT_RECEIVED") &&
      !reportJson.includes("DIRECT_DELIVERY_COST") &&
      !reportJson.includes("ALLOCATED_OPERATING_COST") &&
      !reportJson.includes("52000")
  )

  // Period filtering: all fixture rows are dated 2026-11-01..2026-11-30.
  const now = new Date()
  const novemberIsThisMonth = now.getFullYear() === 2026 && now.getMonth() === 10
  if (!novemberIsThisMonth) {
    const thisMonth = await buildReportLikeClientReport("this_month")
    check(
      "this_month (not November 2026): out-of-period rows are excluded, so profit is INCOMPLETE rather than a false number",
      thisMonth.ok && thisMonth.report.profit.status === "INCOMPLETE"
    )
    check("this_month: out-of-period targets are excluded", thisMonth.ok && thisMonth.report.targets.length === 0)
  }
  if (now.getFullYear() === 2026) {
    const thisYear = await buildReportLikeClientReport("this_year")
    check(
      "this_year (2026): November rows are included, same 93000 as all time",
      thisYear.ok && thisYear.report.profit.status === "COMPLETE" && thisYear.report.profit.amount === 93000
    )
  }

  // --- Edit + re-approval during report generation ------------------------
  // DIRECT_DELIVERY_COST rows are used for the interleaved edits because they
  // invalidate approval like any financial write but don't change the
  // client-profit figure later steps assert on.
  console.log("\nStep 9b: edit + re-approval during report generation")

  async function editAndReapprove(version, label) {
    const { error: editError } = await client.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: "DIRECT_DELIVERY_COST",
      p_amount: 1000,
      p_value_status: "CONFIRMED",
      p_period_start: "2026-11-01",
      p_period_end: "2026-11-30",
      p_evidence_status: "OWNER_REPORTED",
    })
    const { error: approveErr } = await client.rpc("approve_and_export_project", {
      p_project_id: projectId,
      p_content: `# Vera Wellness -- Project Context (QA v${version})`,
      p_evidence_index_content: `# Vera Wellness -- Evidence Index (QA v${version})`,
      p_export_manifest_content: `# Vera Wellness -- Export Manifest (QA v${version})`,
      p_expected_version: version,
      p_expected_fingerprint: await currentFingerprint(client, projectId),
      p_approval_note: `Vera Wellness QA e2e run: ${label}.`,
    })
    check(`${label}: edit + re-approve (v${version}) both succeed`, !editError && !approveErr, editError?.message ?? approveErr?.message)
  }

  // (a) Reproduce the defect in the OLD multi-request read order, to show the
  //     scenario is real: financial rows read, then edit + re-approve commits,
  //     then the status read still says APPROVED -- over data it never covered.
  const { data: oldOrderFinancials } = await admin
    .from("financial_records")
    .select("id")
    .eq("project_id", projectId)
  await editAndReapprove(3, "old-order reproduction")
  const { data: oldOrderStatus } = await admin.from("projects").select("readiness_status").eq("id", projectId).single()
  const { count: rowsNow } = await admin
    .from("financial_records")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  check(
    "old multi-request order DOES produce a mixed report (7 rows read, status APPROVED at v3 which covers 8)",
    oldOrderFinancials?.length === 7 && oldOrderStatus?.readiness_status === "APPROVED" && rowsNow === 8
  )

  // (b) Same interleaving against the single-statement read. A separate
  //     session holds ACCESS EXCLUSIVE on project_targets, so the report
  //     statement takes its snapshot and then blocks mid-statement. While it
  //     is blocked, an edit + re-approval (which never touch project_targets)
  //     commit. When the lock is released the statement finishes. It must
  //     return the PRE-edit state throughout: v3 and 8 rows, APPROVED.
  const reportLock = await startLockHolder("report race", "")
  check("lock-holding session acquired ACCESS EXCLUSIVE on project_targets", reportLock.held, reportLock.reason)

  if (reportLock.held) {
    const inFlightReport = admin
      .rpc("get_client_report_snapshot", { p_project_id: projectId })
      .then((res) => ({ ...res, resolvedAt: Date.now() }))
    await new Promise((r) => setTimeout(r, 500))

    await editAndReapprove(4, "edit during an in-flight report read")
    const editCommittedAt = Date.now()
    const { data: committedState } = await admin.from("projects").select("readiness_status").eq("id", projectId).single()
    const { count: committedRows } = await admin
      .from("financial_records")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)

    const { data: inFlight, error: inFlightError, resolvedAt } = await inFlightReport
    check("in-flight report read completed without error", !inFlightError, inFlightError?.message)
    check(
      `report read resolved AFTER the edit + re-approval committed (${resolvedAt - editCommittedAt}ms later) -- otherwise the interleaving did not happen and this test is inconclusive`,
      resolvedAt > editCommittedAt
    )
    check(
      "edit + re-approval committed while the read was in flight (DB now APPROVED at v4 with 9 rows)",
      committedState?.readiness_status === "APPROVED" && committedRows === 9
    )
    check(
      "the in-flight read returned ONE consistent pre-edit snapshot: APPROVED, latest export v3, 8 financial rows",
      inFlight?.readiness_status === "APPROVED" &&
        inFlight?.latest_export_version === 3 &&
        inFlight?.financials?.length === 8,
      JSON.stringify({ status: inFlight?.readiness_status, v: inFlight?.latest_export_version, rows: inFlight?.financials?.length })
    )
  }
  await reportLock.done

  const afterRace = await buildReportLikeClientReport("all")
  check(
    "a fresh report read now reflects v4's data and the unchanged client figure (93000)",
    afterRace.ok && afterRace.allFinancialRows.length === 9 && afterRace.report.profit.amount === 93000
  )

  // --- Export content must match what is approved ---------------------------
  console.log("\nStep 9c: stale export content is rejected")
  const exportCount = () =>
    mustCount(
      admin.from("project_exports").select("version", { count: "exact", head: true }).eq("project_id", projectId),
      "project_exports"
    )
  const approveV5 = (fingerprint, label) =>
    client.rpc("approve_and_export_project", {
      p_project_id: projectId,
      p_content: `# Vera Wellness -- Project Context (QA v5, ${label})`,
      p_evidence_index_content: "# Vera Wellness -- Evidence Index (QA v5)",
      p_export_manifest_content: "# Vera Wellness -- Export Manifest (QA v5)",
      p_expected_version: 5,
      p_expected_fingerprint: fingerprint,
    })

  // (a) An edit after the export was generated, with no new export in
  //     between: the version check alone would still pass.
  await client.rpc("add_evidence_item", {
    p_project_id: projectId,
    p_category: "evidence",
    p_external_url: `https://example.com/vera-wellness-qa-${runId}/late-1`,
    p_verification_status: "OWNER_REPORTED",
  })
  check("project is READY_FOR_REVIEW after the evidence edit", (await projectStatus()) === "READY_FOR_REVIEW")
  const generatedFingerprint = await currentFingerprint(client, projectId)
  const { error: laterEditError } = await client.rpc("add_evidence_item", {
    p_project_id: projectId,
    p_category: "evidence",
    p_external_url: `https://example.com/vera-wellness-qa-${runId}/late-2`,
    p_verification_status: "OWNER_REPORTED",
  })
  check("a further edit after the export was generated succeeds (status unchanged, no new export)", !laterEditError)
  const { error: staleError } = await approveV5(generatedFingerprint, "stale")
  check(
    "approval with the pre-edit fingerprint is rejected as stale (PT409), although the version still matches",
    staleError?.code === "PT409",
    staleError ? `${staleError.code}: ${staleError.message}` : "approval succeeded"
  )
  check("rejected approval created no export and left the project READY_FOR_REVIEW",
    (await exportCount()) === 4 && (await projectStatus()) === "READY_FOR_REVIEW")

  // (b) A client edit committing while an approval is in flight. The edit
  //     holds the client row (uncommitted) when approval starts; approval
  //     must wait for it and then see the change, not approve the old name.
  const fingerprintBeforeClientEdit = await currentFingerprint(client, projectId)
  const clientEdit = await startLockHolder(
    "client edit during approval",
    `update public.client_businesses set display_name = display_name || ' (edited)' where id = '${clientBusinessId}';`
  )
  check("client edit is in flight (uncommitted, row locked)", clientEdit.held, clientEdit.reason)
  if (clientEdit.held) {
    const startedAt = Date.now()
    const { error: inFlightApproveError } = await approveV5(fingerprintBeforeClientEdit, "during client edit")
    const waitedMs = Date.now() - startedAt
    await clientEdit.done
    check(`approval waited for the client edit to commit (${waitedMs}ms)`, waitedMs >= 1000)
    check(
      "approval then saw the client change and was rejected as stale (PT409)",
      inFlightApproveError?.code === "PT409",
      inFlightApproveError ? `${inFlightApproveError.code}: ${inFlightApproveError.message}` : "approval succeeded with the old client name"
    )
  }
  check("still no new export after the rejected approvals", (await exportCount()) === 4)

  // (c) Regenerated from current data, approval succeeds.
  const { error: freshApproveError } = await approveV5(await currentFingerprint(client, projectId), "fresh")
  check("approval with a freshly generated fingerprint succeeds (v5)", !freshApproveError, freshApproveError?.message)

  // (d) Re-export of an approved project needs a matching fingerprint too.
  const { error: staleReexportError } = await client.rpc("record_project_export", {
    p_project_id: projectId,
    p_content: "x",
    p_evidence_index_content: "x",
    p_export_manifest_content: "x",
    p_expected_version: 6,
    p_expected_fingerprint: generatedFingerprint,
  })
  check(
    "record_project_export with an outdated fingerprint is rejected (PT409)",
    staleReexportError?.code === "PT409",
    staleReexportError ? `${staleReexportError.code}: ${staleReexportError.message}` : "re-export succeeded"
  )
  check("approved state intact: APPROVED with 5 exports", (await projectStatus()) === "APPROVED" && (await exportCount()) === 5)

  // --- Protected client sharing: create link, exercise PIN + lockout + ---
  //     session-nonce flow exactly as the real Server Actions do.
  console.log("\nStep 10: protected client sharing (share link, PIN, lockout, session nonce)")
  const shareToken = generateShareToken()
  const sharePin = "483920"
  const { data: shareLink, error: shareLinkError } = await client
    .from("client_share_links")
    .insert({
      workspace_id: workspace.id,
      project_id: projectId,
      token: shareToken,
      pin_hash: hashPin(sharePin, shareToken),
      expires_at: new Date(Date.now() + DEFAULT_SHARE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      created_by: qaUserId,
    })
    .select("id")
    .single()
  check("createShareLinkAction's insert succeeds (Owner, RLS-permitted)", !shareLinkError, shareLinkError?.message)
  shareLinkId = shareLink?.id

  // anon must not be able to read client_share_links. Two acceptable
  // mechanisms, each checked explicitly: a privilege error (42501), or a
  // successful response with zero rows because no RLS policy applies to
  // anon. Any OTHER error (network, 5xx, bad query) is a FAIL, not a pass.
  // The owner-side positive control proves "zero rows" means "filtered",
  // not "no such token".
  const { data: ownerRead, error: ownerReadError } = await client
    .from("client_share_links")
    .select("id")
    .eq("token", shareToken)
  check(
    "positive control: the Owner session CAN read this exact link by token",
    !ownerReadError && ownerRead?.length === 1,
    ownerReadError?.message
  )
  const anonClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: anonRead, error: anonReadError } = await anonClient
    .from("client_share_links")
    .select("id")
    .eq("token", shareToken)
  const anonDeniedByGrant = anonReadError?.code === "42501"
  const anonFilteredByRls = !anonReadError && Array.isArray(anonRead) && anonRead.length === 0
  check(
    `anon cannot read the same link (${anonDeniedByGrant ? "privilege denied, 42501" : anonFilteredByRls ? "RLS returned zero rows" : "unexpected result"})`,
    anonDeniedByGrant || anonFilteredByRls,
    anonReadError ? `unexpected error ${anonReadError.code}: ${anonReadError.message}` : `got ${anonRead?.length} row(s)`
  )

  // PIN attempts, each driven through simulateVerifySharePinAction (same
  // branch order as the real Server Action) against the REAL row, with the
  // resulting state written back using the same columns the action writes.
  // This tests the action's logic and the DB round trip -- not the Server
  // Action endpoint, the PinForm, or a real Set-Cookie header.
  async function attemptPin(pin) {
    const { data: row } = await admin
      .from("client_share_links")
      .select("pin_hash, expires_at, revoked_at, failed_pin_attempts, locked_until")
      .eq("token", shareToken)
      .single()
    const result = simulateVerifySharePinAction(pin, shareToken, row)
    if (result.outcome === "WRONG_PIN") {
      await admin
        .from("client_share_links")
        .update({ failed_pin_attempts: result.link.failed_pin_attempts, locked_until: result.link.locked_until })
        .eq("token", shareToken)
    } else if (result.outcome === "OK") {
      await admin
        .from("client_share_links")
        .update({
          session_nonce_hash: result.link.session_nonce_hash,
          session_nonce_expires_at: result.link.session_nonce_expires_at,
          failed_pin_attempts: 0,
          locked_until: null,
          last_accessed_at: new Date().toISOString(),
        })
        .eq("token", shareToken)
    }
    return result
  }

  for (let attempt = 1; attempt <= SHARE_PIN_MAX_ATTEMPTS - 1; attempt++) {
    const r = await attemptPin("000000")
    check(`wrong PIN attempt ${attempt}: outcome WRONG_PIN, not yet locked`, r.outcome === "WRONG_PIN" && !r.lockedOutByThisAttempt)
  }
  const { data: rowBeforeLockout } = await admin
    .from("client_share_links")
    .select("failed_pin_attempts")
    .eq("token", shareToken)
    .single()
  check(`DB row: failed_pin_attempts = ${SHARE_PIN_MAX_ATTEMPTS - 1} after 4 wrong attempts`, rowBeforeLockout.failed_pin_attempts === SHARE_PIN_MAX_ATTEMPTS - 1)

  const fifth = await attemptPin("000000")
  check("wrong PIN attempt 5: outcome WRONG_PIN and triggers lockout", fifth.outcome === "WRONG_PIN" && fifth.lockedOutByThisAttempt)
  const { data: rowAfterLockout } = await admin
    .from("client_share_links")
    .select("failed_pin_attempts, locked_until")
    .eq("token", shareToken)
    .single()
  check(
    "DB row: counter reset to 0 and locked_until ~15 minutes ahead",
    rowAfterLockout.failed_pin_attempts === 0 &&
      Math.abs(new Date(rowAfterLockout.locked_until).getTime() - (Date.now() + SHARE_PIN_LOCKOUT_SECONDS * 1000)) < 60_000
  )

  const correctWhileLocked = await attemptPin(sharePin)
  check(
    "CORRECT PIN submitted during lockout: rejected by the lockout branch (outcome LOCKED), no session issued",
    correctWhileLocked.outcome === "LOCKED"
  )
  const { data: rowAfterLockedAttempt } = await admin
    .from("client_share_links")
    .select("session_nonce_hash")
    .eq("token", shareToken)
    .single()
  check("DB row: no session nonce was stored by the locked-out attempt", rowAfterLockedAttempt.session_nonce_hash === null)

  // Lockout expiry is simulated by moving locked_until into the past; the
  // real 15-minute wait is not exercised.
  await admin
    .from("client_share_links")
    .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
    .eq("token", shareToken)
  const afterExpiry = await attemptPin(sharePin)
  check("correct PIN after lockout expiry: outcome OK", afterExpiry.outcome === "OK")
  const { data: rowAfterVerify } = await admin
    .from("client_share_links")
    .select("session_nonce_hash, session_nonce_expires_at, failed_pin_attempts, locked_until")
    .eq("token", shareToken)
    .single()
  check(
    "DB row: session nonce hash stored, counters cleared",
    !!rowAfterVerify.session_nonce_hash && rowAfterVerify.failed_pin_attempts === 0 && rowAfterVerify.locked_until === null
  )

  // Nonce check: the value the real action would put in the cookie is
  // matched against the stored hash with the same isSessionNonceValid the
  // share page uses. No real cookie or browser is involved here.
  const nonce = afterExpiry.nonce
  const sessionExpiresAt = rowAfterVerify.session_nonce_expires_at
  check(
    "isSessionNonceValid: the issued nonce value matches the stored hash",
    isSessionNonceValid(nonce, rowAfterVerify.session_nonce_hash, sessionExpiresAt)
  )
  check(
    "isSessionNonceValid: no nonce presented -> not verified",
    !isSessionNonceValid(undefined, rowAfterVerify.session_nonce_hash, sessionExpiresAt)
  )
  check(
    "isSessionNonceValid: a different random nonce -> not verified",
    !isSessionNonceValid(generateSessionNonce(), rowAfterVerify.session_nonce_hash, sessionExpiresAt)
  )

  const reportViaShare = await buildReportLikeClientReport("all")
  check(
    "report computed for the share link's project is available with the full-dataset figure (93000)",
    reportViaShare.ok && reportViaShare.report.profit.amount === 93000
  )

  // Revoke: revokeShareLinkAction's exact update shape -- must also clear
  // the session nonce, not just set revoked_at, so an already-verified
  // browser loses access immediately.
  const { error: revokeError } = await client
    .from("client_share_links")
    .update({ revoked_at: new Date().toISOString(), session_nonce_hash: null, session_nonce_expires_at: null })
    .eq("id", shareLinkId)
  check("revokeShareLinkAction's update succeeds (Owner)", !revokeError, revokeError?.message)
  const { data: linkAfterRevoke } = await admin
    .from("client_share_links")
    .select("revoked_at, session_nonce_hash")
    .eq("id", shareLinkId)
    .single()
  check("revoked_at is set and the session nonce hash is cleared", !!linkAfterRevoke.revoked_at && linkAfterRevoke.session_nonce_hash === null)
  check(
    "isSessionNonceValid: the previously issued nonce is no longer valid after revoke",
    !isSessionNonceValid(nonce, linkAfterRevoke.session_nonce_hash, sessionExpiresAt)
  )

  // --- Export version storage: every approved snapshot retained as-is ----
  //     (placeholder Markdown -- the real generator is not exercised here).
  console.log("\nStep 11: export snapshot storage integrity (v1-v5)")
  const { data: finalExportCheck } = await client
    .from("project_exports")
    .select("version, content, evidence_index_content, export_manifest_content")
    .eq("project_id", projectId)
    .order("version", { ascending: true })
  check(
    "all five export versions (v1-v5) are retained in order",
    finalExportCheck?.map((e) => e.version).join(",") === "1,2,3,4,5"
  )
  const v1 = finalExportCheck?.[0]
  check(
    "v1's three files are unchanged by later approvals",
    v1?.content === "# Vera Wellness -- Project Context (QA v1)" &&
      v1?.evidence_index_content === "# Vera Wellness -- Evidence Index (QA v1)" &&
      v1?.export_manifest_content === "# Vera Wellness -- Export Manifest (QA v1)"
  )

  // --- Summary ----------------------------------------------------------
  console.log(`\n${passCount} passed, ${failures.length} failed.`)
  if (failures.length > 0) {
    console.log("\nFailed checks:")
    for (const f of failures) console.log(`  - ${f}`)
  }
  console.log(
    "\nScope: DB integration checks passed means the real RPCs/tables/RLS behave correctly through a real aal2 " +
      "session, and the report/PIN LOGIC (faithful copies of profit.ts, period.ts, verifySharePinAction) " +
      "produces the right results on real rows. NOT covered here (application E2E, pending): the real Markdown " +
      "export generator and ZIP download, the rendered /share/[token] page, the PinForm Server Action over HTTP, " +
      "and real Set-Cookie behavior -- see e2e/ (Playwright) for those."
  )
}

main()
  .then(async () => {
    const cleanupFailures = await cleanup()
    if (failures.length > 0 || cleanupFailures.length > 0) {
      console.log(`\nExiting non-zero: ${failures.length} check failure(s), ${cleanupFailures.length} cleanup failure(s).`)
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
