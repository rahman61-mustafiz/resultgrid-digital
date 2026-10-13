#!/usr/bin/env node
/**
 * DB-integration acceptance for Priority #7: project transfer, lifecycle,
 * archive/restore and permanent-deletion rules
 * (supabase/migrations/20261008100000_lifecycle_archive_delete_rules.sql,
 * 20261008110000_share_links_follow_archive.sql, and the backstops in
 * 20261009100000_lifecycle_backstops.sql / 20261009110000).
 *
 * Runs against the linked dev Supabase project through a real password +
 * TOTP (aal2) session for a throwaway QA Owner, exactly like
 * qa-approval-ledger-acceptance.mjs. Synthetic "QA Lifecycle" fixtures only.
 * Test control that has no app path -- moving archived_at back 31 days to
 * reach the 30-day deletion window -- runs as the database owner through the
 * Supabase CLI, with the read-only guard disabled only inside that one
 * transaction.
 *
 *   node --env-file=.env.local scripts/qa-lifecycle-acceptance.mjs
 *
 * On exit it removes exactly this run's fixtures (clients, projects,
 * lifecycle history, membership, MFA factor, auth user) and verifies it.
 */
import { createClient } from "@supabase/supabase-js"
import { createHmac, randomBytes } from "node:crypto"
import { execFile, execFileSync } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { mustCount, purgeQaClients } from "./lib/qa-fixtures.mjs"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, value] of Object.entries({ SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY })) {
  if (!value) {
    console.error(`Missing required env var for ${name}`)
    process.exit(1)
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const PREFIX = "QA Lifecycle "
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest()
  const o = hmac[hmac.length - 1] & 0x0f
  const n = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) | ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff)
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

/** The call must fail, and (if given) with a message matching `pattern`. */
async function rejects(label, promise, pattern) {
  const { error } = await promise
  const ok = !!error && (!pattern || pattern.test(error.message))
  check(label, ok, error ? error.message : "expected an error, got none")
}

/** Test control as the database owner, in one transaction. */
function runOwnerSql(statements) {
  const path = join(tmpdir(), `rg-qa-lifecycle-${Date.now()}-${process.pid}.sql`)
  writeFileSync(path, ["begin;", ...statements, "commit;"].join("\n"))
  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", path], { stdio: "pipe", shell: true })
  } finally {
    unlinkSync(path)
  }
}

/** Owner-level SQL that must be refused, with output matching `pattern`. */
function ownerSqlRejects(label, statements, pattern) {
  try {
    runOwnerSql(statements)
    check(label, false, "statement succeeded")
  } catch (err) {
    const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}${err?.message ?? ""}`
    check(label, pattern.test(out), out.slice(0, 300))
  }
}

/** One database-owner session, run asynchronously (for the concurrency checks). */
function ownerSqlAsync(sql) {
  const path = join(tmpdir(), `rg-qa-lifecycle-async-${Date.now()}-${randomBytes(4).toString("hex")}.sql`)
  writeFileSync(path, sql)
  return new Promise((resolve) => {
    execFile("npx", ["supabase", "db", "query", "--linked", "-f", path], { shell: true, timeout: 120_000 }, (err, stdout, stderr) => {
      try {
        unlinkSync(path)
      } catch {}
      resolve({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}${err?.message ?? ""}` })
    })
  })
}

function backdateProjectArchive(projectId, days) {
  if (!UUID.test(projectId)) throw new Error("bad id")
  runOwnerSql([
    "alter table public.projects disable trigger projects_enforce_update;",
    `update public.projects set archived_at = now() - interval '${days} days' where id = '${projectId}' and lifecycle_status = 'ARCHIVED';`,
    "alter table public.projects enable trigger projects_enforce_update;",
  ])
}

function backdateClientArchive(clientId, days) {
  if (!UUID.test(clientId)) throw new Error("bad id")
  runOwnerSql([
    "alter table public.client_businesses disable trigger client_businesses_enforce_update;",
    `update public.client_businesses set archived_at = now() - interval '${days} days' where id = '${clientId}' and status = 'ARCHIVED';`,
    "alter table public.client_businesses enable trigger client_businesses_enforce_update;",
  ])
}

const runId = Date.now().toString(36)
const qaEmail = `qa-lifecycle-${runId}@resultgriddigital.internal`
const qaPassword = `Qa-${randomBytes(12).toString("hex")}!Aa1`
let qaUserId = null
let mfaFactorId = null
const clientIds = []

async function cleanup() {
  console.log("\nCleaning up this run's fixtures...")
  const problems = []
  const attempt = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      problems.push(`${label}: ${err?.message ?? err}`)
    }
  }
  if (clientIds.length > 0) await attempt("purge clients/projects/lifecycle history", () => purgeQaClients(admin, clientIds, PREFIX))
  await attempt("lifecycle history of this run", async () => {
    // Includes rows for projects/clients already permanently deleted by the run.
    const { data, error } = await admin.from("lifecycle_events").select("entity_id").like("entity_name", `${PREFIX}${runId}%`)
    if (error) throw error
    const ids = [...new Set((data ?? []).map((r) => r.entity_id))]
    if (ids.length > 0) {
      for (const id of ids) if (!UUID.test(id)) throw new Error(`bad id ${id}`)
      runOwnerSql([
        "alter table public.lifecycle_events disable trigger lifecycle_events_forbid_delete;",
        `delete from public.lifecycle_events where entity_id in (${ids.map((i) => `'${i}'`).join(", ")}) and entity_name like '${PREFIX}${runId}%';`,
        "alter table public.lifecycle_events enable trigger lifecycle_events_forbid_delete;",
      ])
    }
    const left = await mustCount(
      admin.from("lifecycle_events").select("id", { count: "exact", head: true }).like("entity_name", `${PREFIX}${runId}%`),
      "lifecycle_events after purge"
    )
    if (left !== 0) throw new Error(`${left} lifecycle event(s) left`)
  })
  if (qaUserId) {
    if (mfaFactorId) {
      await attempt("MFA factor", async () => {
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
      if (left !== 0) throw new Error(`${left} membership row(s) left`)
    })
    await attempt("auth user", async () => {
      const { error } = await admin.auth.admin.deleteUser(qaUserId)
      if (error) throw new Error(`hard delete failed: ${error.message}`)
      const { data, error: lookupError } = await admin.auth.admin.getUserById(qaUserId)
      if (data?.user) throw new Error("still resolvable after delete")
      if (lookupError && lookupError.status !== 404) throw new Error(`could not verify: ${lookupError.message}`)
    })
  }
  if (problems.length > 0) {
    console.log("Cleanup INCOMPLETE:")
    for (const p of problems) console.log(`  - ${p}`)
  } else {
    console.log("Cleanup verified: this run's clients, projects, lifecycle history, membership, MFA factor and auth user are all gone.")
  }
  return problems
}

async function main() {
  console.log(`Lifecycle acceptance run ${runId}\n`)
  const { data: workspace } = await admin.from("workspaces").select("id").limit(1).single()
  if (!workspace) throw new Error("no workspace found")

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: qaEmail, password: qaPassword, email_confirm: true })
  if (createError) throw createError
  qaUserId = created.user.id
  const { error: memberError } = await admin.from("workspace_members").insert({ workspace_id: workspace.id, user_id: qaUserId, role: "OWNER" })
  if (memberError) throw memberError

  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email: qaEmail, password: qaPassword })
  if (signInError) throw signInError
  const { data: enroll, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp" })
  if (enrollError) throw enrollError
  mfaFactorId = enroll.id
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: enroll.id })
  if (challengeError) throw challengeError
  const { error: verifyError } = await client.auth.mfa.verify({ factorId: enroll.id, challengeId: challenge.id, code: totpCode(enroll.totp.secret) })
  if (verifyError) throw verifyError
  console.log("Signed in at aal2 (password + TOTP just now).\n")

  const newClient = async (suffix) => {
    const { data, error } = await client
      .from("client_businesses")
      .insert({ workspace_id: workspace.id, display_name: `${PREFIX}${runId} ${suffix}`, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka" })
      .select("id, display_name")
      .single()
    if (error) throw error
    clientIds.push(data.id)
    return data
  }
  const projectRow = (clientId, name, extra = {}) => ({
    workspace_id: workspace.id,
    client_business_id: clientId,
    project_name: `${PREFIX}${runId} ${name}`,
    project_type: "SEO",
    lifecycle_status: "ACTIVE",
    default_currency: "BDT",
    timezone: "Asia/Dhaka",
    ...extra,
  })
  const newProject = async (clientId, name) => {
    const { data, error } = await client.from("projects").insert(projectRow(clientId, name)).select("id, project_name").single()
    if (error) throw error
    return data
  }
  const lifecycle = (projectId, to, reason) =>
    client.rpc("set_project_lifecycle", { p_project_id: projectId, p_to_status: to, p_reason: reason })
  const status = async (projectId) =>
    (await admin.from("projects").select("lifecycle_status").eq("id", projectId).single()).data?.lifecycle_status
  const answer = (projectId, value = "QA lifecycle answer") =>
    client.rpc("upsert_project_answer", {
      p_project_id: projectId,
      p_question_key: "E01.Q01",
      p_questionnaire_version: 1,
      p_status: "ANSWERED",
      p_value: value,
      p_next_readiness_status: "READY_FOR_REVIEW",
    })
  const shareLink = (projectId) =>
    client.from("client_share_links").insert({
      workspace_id: workspace.id,
      project_id: projectId,
      token: randomBytes(16).toString("hex"),
      pin_hash: "qa-not-a-real-hash",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single()

  const clientA = await newClient("A")
  const clientB = await newClient("B")
  const clientC = await newClient("C")

  // --- 1. New projects -----------------------------------------------------
  console.log("Step 1: a new project starts ACTIVE + INCOMPLETE")
  await rejects("a project can't be created ON_HOLD", client.from("projects").insert(projectRow(clientA.id, "bad-1", { lifecycle_status: "ON_HOLD" })), /must start ACTIVE/)
  await rejects("a project can't be created ARCHIVED", client.from("projects").insert(projectRow(clientA.id, "bad-2", { lifecycle_status: "ARCHIVED", archived_at: new Date().toISOString() })))
  await rejects("a project can't be created already APPROVED", client.from("projects").insert(projectRow(clientA.id, "bad-3", { readiness_status: "APPROVED" })), /must start ACTIVE and INCOMPLETE|permission denied/)
  await rejects("a client can't be created ARCHIVED", client.from("client_businesses").insert({ workspace_id: workspace.id, display_name: `${PREFIX}${runId} bad`, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka", status: "ARCHIVED", archived_at: new Date().toISOString() }), /must start ACTIVE/)
  const p1 = await newProject(clientA.id, "P1")
  check("a normal project is created ACTIVE", (await status(p1.id)) === "ACTIVE")

  // --- 2. No transfer -------------------------------------------------------
  console.log("\nStep 2: a project can't be moved to another client")
  await rejects(
    "update_project_details no longer accepts a client",
    client.rpc("update_project_details", { p_project_id: p1.id, p_client_business_id: clientB.id, p_project_name: p1.project_name, p_project_type: "SEO", p_default_currency: "BDT", p_timezone: "Asia/Dhaka" })
  )
  await rejects(
    "update_project_details no longer accepts a lifecycle status",
    client.rpc("update_project_details", { p_project_id: p1.id, p_lifecycle_status: "COMPLETED", p_project_name: p1.project_name, p_project_type: "SEO", p_default_currency: "BDT", p_timezone: "Asia/Dhaka" })
  )
  await rejects("the service role can't change a project's client", admin.from("projects").update({ client_business_id: clientB.id }).eq("id", p1.id))
  // The table trigger is the backstop below every privilege: even the
  // database owner is stopped.
  try {
    runOwnerSql([`update public.projects set client_business_id = '${clientB.id}' where id = '${p1.id}';`])
    check("even the database owner can't move a project (trigger)", false, "update succeeded")
  } catch (err) {
    const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}${err?.message ?? ""}`
    check("even the database owner can't move a project (trigger)", /cannot be moved/.test(out), out.slice(0, 300))
  }
  const { data: stillA } = await admin.from("projects").select("client_business_id").eq("id", p1.id).single()
  check("the project is still under its original client", stillA?.client_business_id === clientA.id)
  const { error: detailsError } = await client.rpc("update_project_details", { p_project_id: p1.id, p_project_name: p1.project_name, p_project_type: "SEO", p_default_currency: "BDT", p_timezone: "Asia/Dhaka" })
  check("ordinary detail edits still work", !detailsError, detailsError?.message)

  // --- 3. Lifecycle edges ------------------------------------------------------
  console.log("\nStep 3: lifecycle moves only along the allowed edges")
  check("ACTIVE -> ON_HOLD", !(await lifecycle(p1.id, "ON_HOLD")).error)
  check("ON_HOLD -> ACTIVE", !(await lifecycle(p1.id, "ACTIVE")).error)
  await rejects("ACTIVE -> ACTIVE is rejected", lifecycle(p1.id, "ACTIVE"), /already ACTIVE/)
  await rejects("an unknown status is rejected", lifecycle(p1.id, "DONE"), /cannot move from ACTIVE to DONE/)
  check("ACTIVE -> COMPLETED", !(await lifecycle(p1.id, "COMPLETED")).error)
  await rejects("COMPLETED -> ON_HOLD is not an allowed edge", lifecycle(p1.id, "ON_HOLD"), /cannot move from COMPLETED to ON_HOLD/)
  await rejects("reopening a completed project without a reason is rejected", lifecycle(p1.id, "ACTIVE", "  "), /requires a reason/)
  check("COMPLETED -> ACTIVE with a reason (reopen)", !(await lifecycle(p1.id, "ACTIVE", "Client extended the engagement")).error)
  await rejects("lifecycle can't be written directly", client.from("projects").update({ lifecycle_status: "COMPLETED" }).eq("id", p1.id))
  check("direct write left the status unchanged", (await status(p1.id)) === "ACTIVE")
  const { data: events } = await client.from("lifecycle_events").select("event_type, from_status, to_status, reason, actor_id").eq("entity_id", p1.id).order("created_at")
  check(
    "every change is in the lifecycle history with actor and reason",
    JSON.stringify(events?.map((e) => `${e.from_status}>${e.to_status}`)) === JSON.stringify(["ACTIVE>ON_HOLD", "ON_HOLD>ACTIVE", "ACTIVE>COMPLETED", "COMPLETED>ACTIVE"]) &&
      events?.every((e) => e.actor_id === qaUserId) &&
      events?.[3]?.reason === "Client extended the engagement",
    JSON.stringify(events)
  )

  // --- 4. Archive a project -------------------------------------------------------
  console.log("\nStep 4: archiving a project makes it read-only and revokes its share links")
  const { data: link1, error: link1Error } = await shareLink(p1.id)
  check("share link created on the active project", !link1Error, link1Error?.message)
  check("ACTIVE -> ARCHIVED", !(await lifecycle(p1.id, "ARCHIVED", "Created under the wrong client")).error)
  const { data: link1After } = await admin.from("client_share_links").select("revoked_at, session_nonce_hash").eq("id", link1.id).single()
  check("its share link was revoked, session cleared", link1After?.revoked_at !== null && link1After?.session_nonce_hash === null)
  await rejects("answers can't be saved on an archived project", answer(p1.id), /archived and read-only/)
  await rejects("evidence can't be added", client.rpc("add_evidence_item", { p_project_id: p1.id, p_category: "evidence", p_external_url: "https://example.com/qa", p_verification_status: "OWNER_REPORTED" }), /archived and read-only/)
  await rejects("financial records can't be added", client.rpc("add_financial_record", { p_project_id: p1.id, p_record_type: "MARKETING_SPEND", p_amount: 100, p_value_status: "CONFIRMED", p_period_start: "2026-11-01", p_period_end: "2026-11-30", p_evidence_status: "OWNER_REPORTED", p_attributed_to_marketing: false }), /archived and read-only/)
  await rejects("project details can't be edited", client.rpc("update_project_details", { p_project_id: p1.id, p_project_name: p1.project_name, p_project_type: "SEO", p_default_currency: "BDT", p_timezone: "Asia/Dhaka" }), /archived and read-only/)
  await rejects("new share links can't be created", shareLink(p1.id), /archived and read-only/)
  await rejects("a revoked link can't be brought back (extend)", client.from("client_share_links").update({ revoked_at: null, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }).eq("id", link1.id), /archived and read-only/)
  await rejects("set_project_lifecycle refuses an archived project", lifecycle(p1.id, "ACTIVE", "x"), /use restore/)

  // --- 5. Archive a client ----------------------------------------------------------
  console.log("\nStep 5: a client can only be archived with no active/on-hold projects")
  const p2 = await newProject(clientA.id, "P2")
  const { error: spendError } = await client.rpc("add_financial_record", { p_project_id: p2.id, p_record_type: "MARKETING_SPEND", p_amount: 1234, p_value_status: "CONFIRMED", p_period_start: "2026-11-01", p_period_end: "2026-11-30", p_evidence_status: "OWNER_REPORTED", p_attributed_to_marketing: false })
  check("P2 gets a financial record (protected history)", !spendError, spendError?.message)
  const { data: link2 } = await shareLink(p2.id)
  await rejects("archiving client A is refused while P2 is ACTIVE", client.rpc("archive_client_business", { p_client_business_id: clientA.id }), /1 active or on-hold project/)
  check("P2 ACTIVE -> COMPLETED", !(await lifecycle(p2.id, "COMPLETED")).error)
  const { error: archiveAError } = await client.rpc("archive_client_business", { p_client_business_id: clientA.id, p_reason: "Engagement ended" })
  check("client A archived once no project is active/on hold", !archiveAError, archiveAError?.message)
  const { data: link2After } = await admin.from("client_share_links").select("revoked_at").eq("id", link2.id).single()
  check("P2's share link was revoked with the client", link2After?.revoked_at !== null)
  await rejects("client status can't be written directly", client.from("client_businesses").update({ status: "ACTIVE", archived_at: null }).eq("id", clientA.id))

  console.log("\nStep 6: an archived client receives no new work")
  await rejects("no new project under an archived client", client.from("projects").insert(projectRow(clientA.id, "P3")), /archived: restore it before adding projects/)
  await rejects("its COMPLETED project is read-only", answer(p2.id), /client\/business is archived and read-only/)
  await rejects("its COMPLETED project can't be reopened", lifecycle(p2.id, "ACTIVE", "try"), /client\/business is archived/)
  await rejects("its archived project can't be restored", client.rpc("restore_project", { p_project_id: p1.id }), /restore the client first/)
  await rejects(
    "the archived client's details can't be edited",
    client.rpc("update_client_business_details", { p_client_business_id: clientA.id, p_display_name: clientA.display_name, p_record_type: "EXTERNAL_CLIENT", p_country: "Bangladesh", p_timezone: "Asia/Dhaka" }),
    /archived and read-only/
  )
  check("its COMPLETED project can still be archived", !(await lifecycle(p2.id, "ARCHIVED")).error)

  console.log("\nStep 7: restore returns things to where they were")
  check("client A restored", !(await client.rpc("restore_client_business", { p_client_business_id: clientA.id })).error)
  const { error: restoreP1Error } = await client.rpc("restore_project", { p_project_id: p1.id, p_reason: "Needed after all" })
  check("P1 restored", !restoreP1Error, restoreP1Error?.message)
  check("P1 is back to the status it had before archiving (ACTIVE)", (await status(p1.id)) === "ACTIVE")
  const { error: restoreP2Error } = await client.rpc("restore_project", { p_project_id: p2.id })
  check("P2 restored", !restoreP2Error, restoreP2Error?.message)
  check("P2 is back to COMPLETED, not ACTIVE", (await status(p2.id)) === "COMPLETED")
  check("restored P1 accepts answers again", !(await answer(p1.id)).error)
  await rejects("restore refuses a project that isn't archived", client.rpc("restore_project", { p_project_id: p1.id }), /only an archived project/)

  // --- 8. Permanent deletion ---------------------------------------------------------
  console.log("\nStep 8: permanent deletion")
  const del = (projectId, name) => client.rpc("delete_project_permanently", { p_project_id: projectId, p_confirm_name: name })
  await rejects("an active project can't be deleted", del(p1.id, p1.project_name), /only an archived project/)
  check("P1 archived again", !(await lifecycle(p1.id, "ARCHIVED")).error)
  await rejects("deleting before 30 days archived is refused", del(p1.id, p1.project_name), /30 days after archiving/)
  backdateProjectArchive(p1.id, 31)
  await rejects("a wrong confirmation name is refused", del(p1.id, `${p1.project_name} `), /type the project name exactly/)
  const { error: deleteP1Error } = await del(p1.id, p1.project_name)
  check("P1 (no protected history) is permanently deleted", !deleteP1Error, deleteP1Error?.message)
  const p1Left = await mustCount(admin.from("projects").select("id", { count: "exact", head: true }).eq("id", p1.id), "P1")
  const p1Answers = await mustCount(admin.from("project_answers").select("id", { count: "exact", head: true }).eq("project_id", p1.id), "P1 answers")
  check("P1 and its answers are gone", p1Left === 0 && p1Answers === 0)
  const { data: deleteEvent } = await client.from("lifecycle_events").select("event_type, entity_name, actor_id").eq("entity_id", p1.id).eq("event_type", "PERMANENTLY_DELETED").single()
  check("the deletion stays on record with the project's name and actor", deleteEvent?.entity_name === p1.project_name && deleteEvent?.actor_id === qaUserId)

  check("P2 archived", !(await lifecycle(p2.id, "ARCHIVED")).error)
  backdateProjectArchive(p2.id, 31)
  const { data: retained } = await client.rpc("project_retained_history", { p_project_id: p2.id })
  check("P2's retained history is reported", JSON.stringify(retained) === JSON.stringify(["financial records"]), JSON.stringify(retained))
  await rejects("P2 (financial records) is never permanently deleted", del(p2.id, p2.project_name), /must be retained because it has financial records/)
  const p2Records = await mustCount(admin.from("financial_records").select("id", { count: "exact", head: true }).eq("project_id", p2.id), "P2 records")
  check("P2 and its financial record are intact", p2Records === 1)

  const delClient = (id, name) => client.rpc("delete_client_business_permanently", { p_client_business_id: id, p_confirm_name: name })
  await rejects("an active client can't be deleted", delClient(clientB.id, clientB.display_name), /only an archived/)
  check("client B archived", !(await client.rpc("archive_client_business", { p_client_business_id: clientB.id })).error)
  await rejects("client B before 30 days is refused", delClient(clientB.id, clientB.display_name), /30 days after archiving/)
  backdateClientArchive(clientB.id, 31)
  await rejects("client B with a wrong name is refused", delClient(clientB.id, "nope"), /type the client\/business name exactly/)
  const { error: deleteBError } = await delClient(clientB.id, clientB.display_name)
  check("client B (no projects) is permanently deleted", !deleteBError, deleteBError?.message)
  check("client A archived (its projects are archived)", !(await client.rpc("archive_client_business", { p_client_business_id: clientA.id })).error)
  backdateClientArchive(clientA.id, 31)
  await rejects("client A is kept while it still has a (retained) project", delClient(clientA.id, clientA.display_name), /still has 1 project/)
  await rejects("anon can't call the delete RPC", createClient(SUPABASE_URL, ANON_KEY).rpc("delete_project_permanently", { p_project_id: p2.id, p_confirm_name: p2.project_name }))

  // --- 9. History is append-only ------------------------------------------------------
  console.log("\nStep 9: lifecycle history is append-only")
  await rejects("the Owner can't insert history directly", client.from("lifecycle_events").insert({ workspace_id: workspace.id, entity_type: "PROJECT", entity_id: p2.id, entity_name: "forged", event_type: "RESTORED" }))
  await rejects("the service role can't edit history", admin.from("lifecycle_events").update({ reason: "rewritten" }).eq("entity_id", p2.id))
  await rejects("the service role can't delete history", admin.from("lifecycle_events").delete().eq("entity_id", p2.id))
  const historyLeft = await mustCount(admin.from("lifecycle_events").select("id", { count: "exact", head: true }).eq("entity_id", p2.id), "P2 history")
  check("P2's history is intact", historyLeft >= 4, String(historyLeft))

  // --- 10. Deletes only through the checked RPCs -------------------------------------
  console.log("\nStep 10: no write path gets around the permanent-delete rules")
  await rejects("the service role can't delete a project directly", admin.from("projects").delete().eq("id", p2.id), /permission denied/)
  await rejects("the service role can't delete a client directly", admin.from("client_businesses").delete().eq("id", clientA.id), /permission denied/)
  await rejects("the service role can't delete a workspace", admin.from("workspaces").delete().eq("id", workspace.id), /permission denied/)
  await rejects("the Owner can't delete a project directly", client.from("projects").delete().eq("id", p2.id), /permission denied/)
  ownerSqlRejects(
    "even the database owner can't delete a retained project outside the RPC (trigger)",
    [`delete from public.projects where id = '${p2.id}';`],
    /can only be removed with delete_project_permanently/
  )
  const p2RecordsAfter = await mustCount(admin.from("financial_records").select("id", { count: "exact", head: true }).eq("project_id", p2.id), "P2 records")
  check("P2 and its financial record survive every direct delete", p2RecordsAfter === 1 && (await status(p2.id)) === "ARCHIVED")
  const p4 = await newProject(clientC.id, "P4")
  const { data: c4, error: c4Error } = await client.from("creatives").insert({ workspace_id: workspace.id, project_id: p4.id, title: "QA draft creative" }).select("id").single()
  check("a draft creative is added to P4", !c4Error, c4Error?.message)
  check("P4 archived", !(await lifecycle(p4.id, "ARCHIVED")).error)
  backdateProjectArchive(p4.id, 31)
  ownerSqlRejects(
    "the database owner can't delete even an eligible project without the RPC's record",
    [`delete from public.projects where id = '${p4.id}';`],
    /can only be removed with delete_project_permanently/
  )
  ownerSqlRejects(
    "the database owner can't delete a client outside the RPC (trigger)",
    [`delete from public.client_businesses where id = '${clientA.id}';`],
    /can only be removed with delete_client_business_permanently/
  )
  check("P4 is still there", (await status(p4.id)) === "ARCHIVED")

  // --- 11. No reparenting ----------------------------------------------------------------
  console.log("\nStep 11: a project's rows can't be moved to another project")
  const p6 = await newProject(clientC.id, "P6")
  await rejects(
    "a creative can't be moved out of an archived project",
    client.from("creatives").update({ project_id: p6.id }).eq("id", c4.id),
    /cannot be moved to another project/
  )
  const { data: c6 } = await client.from("creatives").insert({ workspace_id: workspace.id, project_id: p6.id, title: "QA creative P6" }).select("id").single()
  const p5 = await newProject(clientC.id, "P5")
  await rejects(
    "a creative can't be moved between two active projects either",
    client.from("creatives").update({ project_id: p5.id }).eq("id", c6.id),
    /cannot be moved to another project/
  )
  const { data: link6 } = await shareLink(p6.id)
  await rejects(
    "a share link can't be moved to another project",
    client.from("client_share_links").update({ project_id: p5.id }).eq("id", link6.id),
    /cannot be moved to another project/
  )
  const { data: c4After } = await admin.from("creatives").select("project_id").eq("id", c4.id).single()
  check("the archived project's creative is still in it", c4After?.project_id === p4.id)

  // --- 12. Creative retention is based on history --------------------------------------------
  console.log("\nStep 12: a creative that was ever approved keeps its project retained")
  const { data: c5 } = await client.from("creatives").insert({ workspace_id: workspace.id, project_id: p5.id, title: "QA creative P5", copy: "v1" }).select("id").single()
  const { error: approveC5Error } = await client
    .from("creatives")
    .update({ status: "APPROVED", approved_at: new Date().toISOString(), approved_by: qaUserId })
    .eq("id", c5.id)
  check("the creative is approved (as updateCreativeStatusAction does)", !approveC5Error, approveC5Error?.message)
  const { error: editC5Error } = await client
    .from("creatives")
    .update({ copy: "v2", version: 2, status: "CHANGES_REQUESTED", approved_at: null, approved_by: null, approval_note: null })
    .eq("id", c5.id)
  check("it is then edited (as updateCreativeContentAction does: back to CHANGES_REQUESTED)", !editC5Error, editC5Error?.message)
  const { data: retainedP5 } = await client.rpc("project_retained_history", { p_project_id: p5.id })
  check(
    "after the edit the project is still retained for its approved creative",
    JSON.stringify(retainedP5) === JSON.stringify(["approved or published creatives"]),
    JSON.stringify(retainedP5)
  )
  const { data: c5History } = await client.from("creative_approval_history").select("status, actor_id").eq("creative_id", c5.id)
  check("the approval is on record with its actor", c5History?.length === 1 && c5History[0].status === "APPROVED" && c5History[0].actor_id === qaUserId, JSON.stringify(c5History))
  await rejects("an ever-approved creative can't be deleted", client.from("creatives").delete().eq("id", c5.id), /kept as history/)
  await rejects("the service role can't delete creative approval history", admin.from("creative_approval_history").delete().eq("creative_id", c5.id))
  await rejects("the Owner can't forge creative approval history", client.from("creative_approval_history").insert({ workspace_id: workspace.id, project_id: p5.id, creative_id: c5.id, status: "APPROVED" }))
  check("a draft creative can still be deleted", !(await client.from("creatives").delete().eq("id", c6.id)).error)
  check("P5 archived", !(await lifecycle(p5.id, "ARCHIVED")).error)
  backdateProjectArchive(p5.id, 31)
  await rejects("P5 is never permanently deleted", del(p5.id, p5.project_name), /must be retained because it has approved or published creatives/)

  // --- 13. Lifecycle backstop on the table itself ------------------------------------------------
  console.log("\nStep 13: every status change obeys the matrix and is recorded, whatever the write path")
  check("P6 ACTIVE -> COMPLETED", !(await lifecycle(p6.id, "COMPLETED")).error)
  const p6EventsBefore = await mustCount(admin.from("lifecycle_events").select("id", { count: "exact", head: true }).eq("entity_id", p6.id), "P6 history")
  ownerSqlRejects(
    "the database owner can't make a disallowed move (COMPLETED -> ON_HOLD)",
    [`update public.projects set lifecycle_status = 'ON_HOLD' where id = '${p6.id}';`],
    /cannot move from COMPLETED to ON_HOLD/
  )
  ownerSqlRejects(
    "the database owner can't make even an allowed move without the history record",
    [`update public.projects set lifecycle_status = 'ARCHIVED' where id = '${p6.id}';`],
    /only through set_project_lifecycle/
  )
  ownerSqlRejects(
    "the database owner can't restore a project to a different status than it had",
    [`update public.projects set lifecycle_status = 'ON_HOLD' where id = '${p4.id}';`],
    /returns to the status it had before archiving \(ACTIVE\)/
  )
  ownerSqlRejects(
    "the database owner can't archive a client without the history record",
    [`update public.client_businesses set status = 'ARCHIVED', archived_at = now() where id = '${clientC.id}';`],
    /only through archive_client_business/
  )
  const p6EventsAfter = await mustCount(admin.from("lifecycle_events").select("id", { count: "exact", head: true }).eq("entity_id", p6.id), "P6 history")
  check("P6 is still COMPLETED with unchanged history", (await status(p6.id)) === "COMPLETED" && p6EventsAfter === p6EventsBefore)
  const { data: link6After } = await admin.from("client_share_links").select("revoked_at").eq("id", link6.id).single()
  check("P6's share link was not touched by the refused archive", link6After?.revoked_at === null)

  // --- 14. Archive vs. share-link reactivation, in two real sessions -----------------------------------
  // Session A (database owner via the CLI, acting as this Owner) takes the
  // link row first -- as a direct link update does -- holds it, then
  // reactivates it, whose trigger then needs the project row. Session B is
  // the app's own archive RPC over HTTP, fired while A holds the link. With
  // archive locking the project before the links (the old order) the two
  // deadlock; archive now takes the links first and simply queues.
  // The CLI sends the file as one query, so nothing A does is visible until
  // it ends: B is fired after a delay, and the overlap is proven afterwards
  // from database timestamps (A's lock time < B's transaction start < A's
  // commit). Two CLI sessions can't run at once (each re-initialises the
  // CLI's temporary login role), hence HTTP for B.
  console.log("\nStep 14: archive and a concurrent share-link reactivation don't deadlock")
  const claims = JSON.stringify({ sub: qaUserId, role: "authenticated", aal: "aal2" })
  const raceCase = async (label, setup) => {
    for (const delayMs of [6_000, 8_000, 10_000, 12_000, 14_000, 16_000]) {
      const { linkId, archive } = await setup()
      const sessionA = [
        "begin;",
        `select set_config('request.jwt.claims', '${claims}', true);`,
        "set local role authenticated;",
        `select id from public.client_share_links where id = '${linkId}' for update;`,
        "select set_config('qa.lock_at', clock_timestamp()::text, false);",
        "select pg_sleep(6);", // under the authenticated role's 8s statement timeout
        `update public.client_share_links set revoked_at = null where id = '${linkId}';`,
        "select set_config('qa.reactivated', (select (revoked_at is null)::text from public.client_share_links where id = '" + linkId + "'), false);",
        "commit;",
        "select current_setting('qa.lock_at') as lock_at, clock_timestamp()::text as done_at, current_setting('qa.reactivated') as reactivated;",
      ].join("\n")
      const aDone = ownerSqlAsync(sessionA)
      await new Promise((r) => setTimeout(r, delayMs))
      const t0 = Date.now()
      const { data: bRow, error: bError } = await archive()
      const waited = (Date.now() - t0) / 1000
      const a = await aDone
      const lockAt = (a.out.match(/"lock_at":\s*"([^"]+)"/) ?? [])[1]
      const doneAt = (a.out.match(/"done_at":\s*"([^"]+)"/) ?? [])[1]
      const bStart = bRow?.updated_at
      const overlapped = lockAt && doneAt && bStart && new Date(lockAt) < new Date(bStart) && new Date(bStart) < new Date(doneAt)
      // No contention (B ran before A took the link, or after A ended): A's
      // outcome says nothing about the lock order, so try again.
      if (!overlapped && !bError && (a.ok || waited < 0.5)) {
        console.log(`  ...  ${label}: no overlap with a ${delayMs / 1000}s delay (A ${lockAt}..${doneAt}, B ${bStart}); retrying`)
        continue
      }
      check(`${label}: both sessions committed, no deadlock`, a.ok && !bError, `A: ${a.out.slice(-500)} | B: ${bError?.message}`)
      check(`${label}: B started while A held the link, and queued (${waited.toFixed(1)}s)`, overlapped && waited > 0.5, `A ${lockAt}..${doneAt}, B ${bStart}`)
      check(`${label}: A's reactivation went through first`, /"reactivated":\s*"true"/.test(a.out), a.out.slice(-300))
      const { data: after } = await admin.from("client_share_links").select("revoked_at").eq("id", linkId).single()
      check(`${label}: then the archive revoked the link`, after?.revoked_at != null)
      return
    }
    check(`${label}: sessions overlapped in one of six attempts`, false)
  }
  let raceN = 0
  await raceCase("project archive", async () => {
    const p = await newProject(clientC.id, `P7-${++raceN}`)
    const { data: link } = await shareLink(p.id)
    await client.from("client_share_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id)
    return { linkId: link.id, archive: () => lifecycle(p.id, "ARCHIVED", "QA race") }
  })
  await raceCase("client archive", async () => {
    const c = await newClient(`D-${++raceN}`)
    const p = await newProject(c.id, `P8-${raceN}`)
    const { data: link } = await shareLink(p.id)
    await client.from("client_share_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id)
    await lifecycle(p.id, "COMPLETED")
    return { linkId: link.id, archive: () => client.rpc("archive_client_business", { p_client_business_id: c.id, p_reason: "QA race" }).select("updated_at").single() }
  })
  // --- 15. History ordering and replay inside one transaction ---------------------------------------
  // Several status changes in ONE transaction (owner SQL calling the real
  // RPCs as this Owner): the latest archive decides the restore target, and
  // every change needs its own event (revision), so an earlier event from
  // the same transaction can't be reused for a direct update.
  console.log("\nStep 15: several changes in one transaction keep exact history")
  const asOwner = `select set_config('request.jwt.claims', '${JSON.stringify({ sub: qaUserId, role: "authenticated", aal: "aal2" })}', true);`
  const p9 = await newProject(clientC.id, "P9")
  runOwnerSql([
    asOwner,
    `select public.set_project_lifecycle('${p9.id}', 'ARCHIVED', 'first archive, from ACTIVE');`,
    `select public.restore_project('${p9.id}');`,
    `select public.set_project_lifecycle('${p9.id}', 'ON_HOLD');`,
    `select public.set_project_lifecycle('${p9.id}', 'ARCHIVED', 'second archive, from ON_HOLD');`,
    `select public.restore_project('${p9.id}');`,
  ])
  check("two archive/restore cycles in one transaction restore to the latest pre-archive status (ON_HOLD)", (await status(p9.id)) === "ON_HOLD", await status(p9.id))
  const { data: p9Events } = await admin.from("lifecycle_events").select("event_type, from_status, to_status, entity_revision, seq").eq("entity_id", p9.id).order("seq")
  check(
    "each change has its own event, revisions 1..5 in insertion order",
    JSON.stringify(p9Events?.map((e) => `${e.entity_revision}:${e.from_status}>${e.to_status}`)) ===
      JSON.stringify(["1:ACTIVE>ARCHIVED", "2:ARCHIVED>ACTIVE", "3:ACTIVE>ON_HOLD", "4:ON_HOLD>ARCHIVED", "5:ARCHIVED>ON_HOLD"]),
    JSON.stringify(p9Events)
  )
  const p10 = await newProject(clientC.id, "P10")
  ownerSqlRejects(
    "a direct update can't reuse an earlier event from the same transaction",
    [asOwner, `select public.set_project_lifecycle('${p10.id}', 'ON_HOLD');`, `select public.set_project_lifecycle('${p10.id}', 'ACTIVE');`, `update public.projects set lifecycle_status = 'ON_HOLD' where id = '${p10.id}';`],
    /only through set_project_lifecycle/
  )
  ownerSqlRejects(
    "nor by bumping the revision itself",
    [asOwner, `select public.set_project_lifecycle('${p10.id}', 'ON_HOLD');`, `select public.set_project_lifecycle('${p10.id}', 'ACTIVE');`, `update public.projects set lifecycle_status = 'ON_HOLD', lifecycle_revision = lifecycle_revision + 1 where id = '${p10.id}';`],
    /only through set_project_lifecycle/
  )
  ownerSqlRejects(
    "the revision can't change without a status change",
    [`update public.projects set lifecycle_revision = lifecycle_revision + 1 where id = '${p10.id}';`],
    /revision changes only with a recorded status change/
  )
  const p10Events = await mustCount(admin.from("lifecycle_events").select("id", { count: "exact", head: true }).eq("entity_id", p10.id), "P10 history")
  check("the refused transactions left P10 ACTIVE with no history", (await status(p10.id)) === "ACTIVE" && p10Events === 0, String(p10Events))
}

let exitCode = 0
try {
  await main()
} catch (err) {
  console.error("\nRun aborted:", err)
  exitCode = 1
}
const cleanupProblems = await cleanup()
console.log(`\n${passCount} passed, ${failures.length} failed.`)
if (failures.length > 0 || cleanupProblems.length > 0) exitCode = 1
process.exit(exitCode)
