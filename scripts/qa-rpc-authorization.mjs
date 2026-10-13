#!/usr/bin/env node
/**
 * Every RPC the database exposes, called by three callers who must be
 * refused, against real fixtures (Priority #12, `supabase db advisors`:
 * "authenticated_security_definer_function_executable").
 *
 *   anon      -- no session at all
 *   outsider  -- signed in, TOTP completed (aal2), but not a workspace member
 *   aal1Owner -- an OWNER member who has signed in with a password only
 *
 * The RPC list is read from the API's own schema (service-role OpenAPI), so
 * a function added later is tested automatically. Each call uses valid
 * arguments for this run's fixtures -- the real project, record, target,
 * lead, evidence item and upload -- so a refusal can't come from a bad
 * argument; it must be an authorization error (SQLSTATE 42501 or "not
 * authorized"). Afterwards the fixtures must be unchanged, row for row.
 * A positive control first shows the same arguments work for the Owner at
 * aal2.
 *
 *   node --env-file=.env.local scripts/qa-rpc-authorization.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { createHmac, randomBytes, randomUUID } from "node:crypto"

import { purgeQaClients, purgeQaLeads } from "./lib/qa-fixtures.mjs"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY })) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

const NAME_PREFIX = "QA RPC Authorization "
const runId = randomBytes(4).toString("hex")
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const newClient = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of input.toUpperCase().replace(/=+$/, "")) {
    const val = alphabet.indexOf(char)
    if (val === -1) throw new Error(`invalid base32 character: ${char}`)
    bits += val.toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function totpCode(secret) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest()
  const o = hmac[hmac.length - 1] & 0x0f
  const n = ((hmac[o] & 0x7f) << 24) | (hmac[o + 1] << 16) | (hmac[o + 2] << 8) | hmac[o + 3]
  return String(n % 1_000_000).padStart(6, "0")
}

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

const users = [] // { id, factorId? }
let workspaceId
let clientBusinessId
let leadId

async function makeUser(label, { member, totp }) {
  const email = `qa-rpc-${label}-${runId}@example.com`
  const password = randomBytes(18).toString("base64url")
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const user = { id: data.user.id }
  users.push(user)
  if (member) {
    const { error: memberError } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: user.id, role: "OWNER" })
    if (memberError) throw memberError
  }
  const client = newClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  if (totp) {
    const { data: enroll, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp" })
    if (enrollError) throw enrollError
    user.factorId = enroll.id
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: enroll.id })
    if (challengeError) throw challengeError
    const { error: verifyError } = await client.auth.mfa.verify({ factorId: enroll.id, challengeId: challenge.id, code: totpCode(enroll.totp.secret) })
    if (verifyError) throw verifyError
  }
  const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  return { client, aal: aal?.currentLevel }
}

async function rpcList() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` } })
  if (!res.ok) throw new Error(`could not read the API schema: HTTP ${res.status}`)
  const spec = await res.json()
  return Object.entries(spec.paths)
    .filter(([path]) => path.startsWith("/rpc/"))
    .map(([path, ops]) => {
      const body = (ops.post ?? ops.get)?.parameters?.find((p) => p.in === "body")?.schema?.properties ?? {}
      return { name: path.slice(5), params: Object.entries(body).map(([key, schema]) => ({ key, type: schema.format ?? schema.type })) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Rows that must not change, read with the service role. */
async function snapshot(f) {
  const read = async (table, column, value) => {
    const { data, error } = await admin.from(table).select("*").eq(column, value).order("id")
    if (error) throw new Error(`snapshot of ${table} failed: ${error.message}`)
    return data
  }
  return JSON.stringify({
    client: await read("client_businesses", "id", f.clientId),
    project: await read("projects", "id", f.projectId),
    answers: await read("project_answers", "project_id", f.projectId),
    records: await read("financial_records", "project_id", f.projectId),
    targets: await read("project_targets", "project_id", f.projectId),
    evidence: await read("evidence_items", "project_id", f.projectId),
    uploads: await read("evidence_uploads", "project_id", f.projectId),
    exports: await read("project_exports", "project_id", f.projectId),
    approvals: await read("project_approval_events", "project_id", f.projectId),
    projectLifecycle: await read("lifecycle_events", "entity_id", f.projectId),
    clientLifecycle: await read("lifecycle_events", "entity_id", f.clientId),
    shareLinks: await read("client_share_links", "project_id", f.projectId),
    lead: await read("leads", "id", f.leadId),
    leadArchive: await read("lead_archive_events", "lead_id", f.leadId),
  })
}

function argsFor(rpc, f) {
  const known = {
    p_project_id: f.projectId,
    p_client_business_id: f.clientId,
    p_record_id: f.recordId,
    p_target_id: f.targetId,
    p_item_id: f.itemId,
    p_upload_id: f.uploadId,
    p_lead_id: f.leadId,
    p_export_id: f.exportId,
    p_id: 1,
    p_limit: 1,
    p_confirm_name: f.projectName,
    p_reason: "QA authorization probe",
    p_to_status: "ON_HOLD",
    p_next_status: "INCOMPLETE",
    p_archived: true,
    p_record_type: "MARKETING_SPEND",
    p_value_status: "CONFIRMED",
    p_evidence_status: "OWNER_REPORTED",
    p_verification_status: "UNVERIFIED",
    p_category: "evidence",
    p_external_url: "https://example.com/qa-rpc-authorization",
    p_original_filename: "qa.pdf",
    p_size_bytes: 1000,
    p_metric: "LEADS",
    p_unit: "count",
    p_records: [],
    p_question_key: "E01.Q01",
    p_questionnaire_version: 1,
    p_next_readiness_status: "INCOMPLETE",
    p_value: null,
    p_status: "UNKNOWN",
    p_expected_fingerprint: f.fingerprint,
    p_expected_version: 1,
    p_content: "qa",
    p_evidence_index_content: "qa",
    p_export_manifest_content: "qa",
    p_project_name: f.projectName,
    p_display_name: `${NAME_PREFIX}${runId}`,
  }
  const byType = { uuid: randomUUID(), text: "qa", integer: 1, bigint: 1, numeric: 1, boolean: true, date: "2026-01-15", jsonb: {}, "text[]": [] }
  return Object.fromEntries(rpc.params.map(({ key, type }) => [key, key in known ? known[key] : (byType[type] ?? null)]))
}

// SECURITY INVOKER reads limited by RLS: other callers see no rows rather
// than an error. Any row returned to them is a failure.
const EMPTY_FOR_OTHERS = new Set(["project_retained_history"])

const isAuthorizationError = (error) => error.code === "42501" || /not authorized|permission denied/i.test(error.message)

async function cleanup() {
  console.log("\nCleaning up...")
  const problems = []
  const attempt = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      problems.push(`${label}: ${err?.message ?? err}`)
    }
  }
  if (leadId)
    await attempt("lead", async () => {
      const left = await purgeQaLeads(admin, [leadId], NAME_PREFIX)
      if (left) throw new Error("lead still present")
    })
  if (clientBusinessId) await attempt("client and project", () => purgeQaClients(admin, [clientBusinessId], NAME_PREFIX))
  for (const user of users) {
    if (user.factorId)
      await attempt(`MFA factor of ${user.id}`, async () => {
        const { error } = await admin.auth.admin.mfa.deleteFactor({ id: user.factorId, userId: user.id })
        if (error) throw error
      })
    await attempt(`membership of ${user.id}`, async () => {
      const { error } = await admin.from("workspace_members").delete().eq("user_id", user.id)
      if (error) throw error
    })
    await attempt(`auth user ${user.id}`, async () => {
      const { error } = await admin.auth.admin.deleteUser(user.id)
      if (error) {
        // Same fallback as the other QA scripts: anonymize and ban.
        const { error: softError } = await admin.auth.admin.deleteUser(user.id, true)
        throw new Error(`hard delete failed (${error.message}); soft delete ${softError ? `also failed: ${softError.message}` : "done"}`)
      }
    })
  }
  if (problems.length) {
    console.log("Cleanup INCOMPLETE:")
    for (const p of problems) console.log(`  - ${p}`)
  } else {
    console.log("Cleanup verified: fixtures, memberships, MFA factors and QA users removed.")
  }
  return problems
}

async function main() {
  console.log(`RPC authorization run ${runId}\n`)
  const { data: workspace, error: wsError } = await admin.from("workspaces").select("id").limit(1).single()
  if (wsError || !workspace) throw new Error("no workspace found -- run bootstrap-workspace.mjs first")
  workspaceId = workspace.id

  // --- Fixtures, created by an Owner at aal2 ------------------------------
  const owner = await makeUser("owner", { member: true, totp: true })
  const db = owner.client
  const projectName = `${NAME_PREFIX}${runId}`
  const { data: cb, error: cbError } = await db
    .from("client_businesses")
    .insert({ workspace_id: workspaceId, display_name: projectName, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  if (cbError) throw cbError
  clientBusinessId = cb.id
  const { data: project, error: projectError } = await db
    .from("projects")
    .insert({ workspace_id: workspaceId, client_business_id: cb.id, project_name: projectName, project_type: "SEO", lifecycle_status: "ACTIVE", default_currency: "USD", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  if (projectError) throw projectError
  const { data: record, error: recordError } = await db.rpc("add_financial_record", {
    p_project_id: project.id, p_record_type: "MARKETING_SPEND", p_amount: 100, p_value_status: "CONFIRMED", p_period_start: "2026-01-01", p_period_end: "2026-01-31", p_evidence_status: "OWNER_REPORTED",
  })
  if (recordError) throw recordError
  const { data: target, error: targetError } = await db.rpc("add_project_target", {
    p_project_id: project.id, p_metric: "LEADS", p_unit: "count", p_target: 10, p_period_start: "2026-01-01", p_period_end: "2026-01-31",
  })
  if (targetError) throw targetError
  const { error: itemError } = await db.rpc("add_evidence_item", {
    p_project_id: project.id, p_category: "evidence", p_external_url: "https://example.com/qa-rpc-authorization", p_verification_status: "UNVERIFIED",
  })
  if (itemError) throw itemError
  const { data: item } = await admin.from("evidence_items").select("id").eq("project_id", project.id).single()
  const { data: upload, error: uploadError } = await db.rpc("prepare_evidence_upload", { p_project_id: project.id, p_original_filename: "qa.pdf", p_size_bytes: 1000 })
  if (uploadError) throw uploadError
  const { data: lead, error: leadError } = await admin.from("leads").insert({ workspace_id: workspaceId, name: projectName }).select("id").single()
  if (leadError) throw leadError
  leadId = lead.id
  const { data: snap, error: snapError } = await db.rpc("get_project_export_snapshot", { p_project_id: project.id })
  if (snapError) throw snapError

  const pick = (v) => (typeof v === "object" && v !== null ? (v.id ?? v.upload_id ?? Object.values(v)[0]) : v)
  const fixtures = {
    clientId: cb.id,
    projectId: project.id,
    projectName,
    recordId: pick(record),
    targetId: pick(target),
    itemId: item?.id,
    uploadId: pick(upload),
    leadId: lead.id,
    exportId: randomUUID(), // no export exists; see the note printed below
    fingerprint: snap.fingerprint,
  }
  for (const [k, v] of Object.entries(fixtures)) if (!v) throw new Error(`fixture ${k} missing`)

  // --- Callers -----------------------------------------------------------
  const outsider = await makeUser("outsider", { member: false, totp: true })
  const aal1Owner = await makeUser("aal1owner", { member: true, totp: false })
  const callers = { anon: newClient(), outsider: outsider.client, aal1Owner: aal1Owner.client }

  console.log("Setup")
  check("owner fixture session is aal2", owner.aal === "aal2", owner.aal)
  check("outsider session is aal2", outsider.aal === "aal2", outsider.aal)
  check("OWNER member without TOTP is aal1", aal1Owner.aal === "aal1", aal1Owner.aal)

  const rpcs = await rpcList()
  check(`API schema lists RPCs (${rpcs.length})`, rpcs.length >= 30)

  console.log("\nPositive control: the same arguments work for the Owner at aal2")
  const { error: controlError } = await db.rpc("get_project_export_snapshot", argsFor(rpcs.find((r) => r.name === "get_project_export_snapshot"), fixtures))
  check("get_project_export_snapshot as Owner (aal2)", !controlError, controlError?.message)

  const before = await snapshot(fixtures)

  console.log("\nEvery RPC, every caller: refused for authorization")
  for (const rpc of rpcs) {
    for (const [who, client] of Object.entries(callers)) {
      const { data, error } = await client.rpc(rpc.name, argsFor(rpc, fixtures))
      if (EMPTY_FOR_OTHERS.has(rpc.name) && !error) {
        check(`${rpc.name} as ${who} returns nothing`, Array.isArray(data) && data.length === 0, JSON.stringify(data))
      } else if (rpc.name === "set_export_archived" && error && /^export .* not found$/.test(error.message)) {
        // No export exists in this run (see note below): the id is random.
        check(`${rpc.name} as ${who} (no such export)`, true)
      } else if (!error) {
        check(`${rpc.name} as ${who}`, false, `NOT refused; returned ${JSON.stringify(data)?.slice(0, 120)}`)
      } else {
        check(`${rpc.name} as ${who}`, isAuthorizationError(error), `refused for another reason: ${error.code} ${error.message}`)
      }
    }
  }

  console.log("\nNothing changed")
  check("fixture rows identical before and after every refused call", (await snapshot(fixtures)) === before)
  console.log("\nNote: no export exists in this run, so the export id passed to set_export_archived is random.")
}

let fatal = null
try {
  await main()
} catch (err) {
  fatal = err
  console.error(`\nFATAL: ${err?.message ?? err}`)
}
const cleanupProblems = await cleanup()
console.log(`\n${passCount} passed, ${failures.length} failed.`)
process.exit(fatal || failures.length || cleanupProblems.length ? 1 : 0)
