#!/usr/bin/env node
/**
 * DB-integration acceptance for Priority #9: evidence file attachments,
 * evidence retention and export archiving
 * (supabase/migrations/20261009150000_evidence_attachments_retention.sql).
 *
 * Runs against the linked dev Supabase project through a real password +
 * TOTP (aal2) session for a throwaway QA Owner, like the other acceptance
 * scripts. Synthetic "QA Evidence" fixtures only. The service-role calls
 * stand in for the app's server (verification results, discards, the
 * deletion queue). Test-control steps with no app path run as the database
 * owner: inserting an export row directly (instead of completing 127
 * questions and approving), tampering with a stored object's version,
 * backdating an upload, and queue rows for a referenced path and a failing
 * delete. The real approval and upload paths are covered by the browser
 * suite.
 *
 *   node --env-file=.env.local scripts/qa-evidence-acceptance.mjs
 *
 * On exit it removes exactly this run's fixtures (clients, projects,
 * evidence rows and files, export rows and events, membership, MFA factor,
 * auth user) and verifies it.
 */
import { createClient } from "@supabase/supabase-js"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
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
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
const PREFIX = "QA Evidence "
const BUCKET = "evidence"
const LIMIT = 26214400
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
)
const sha256 = (b) => createHash("sha256").update(b).digest("hex")

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

async function rejects(label, promise, pattern) {
  const { error } = await promise
  const ok = !!error && (!pattern || pattern.test(error.message))
  check(label, ok, error ? error.message : "expected an error, got none")
}

function runOwnerSql(statements) {
  const path = join(tmpdir(), `rg-qa-evidence-${Date.now()}-${process.pid}.sql`)
  writeFileSync(path, ["begin;", ...statements, "commit;"].join("\n"))
  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", path], { stdio: "pipe", shell: true })
  } finally {
    unlinkSync(path)
  }
}

function ownerSqlRejects(label, statements, pattern) {
  try {
    runOwnerSql(statements)
    check(label, false, "statement succeeded")
  } catch (err) {
    const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}${err?.message ?? ""}`
    check(label, pattern.test(out), out.slice(0, 300))
  }
}

const runId = Date.now().toString(36)
const qaEmail = `qa-evidence-${runId}@resultgriddigital.internal`
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
  if (clientIds.length > 0) {
    await attempt("purge clients/projects/evidence rows and files/exports", () => purgeQaClients(admin, clientIds, PREFIX))
  }
  await attempt("stray evidence files of this run", async () => {
    // Uploads that never became evidence rows (the refusal checks below).
    const { data: ws } = await admin.from("workspaces").select("id").limit(1).single()
    for (const projectId of projectIds) {
      const prefix = `${ws.id}/${projectId}`
      const { data: objects, error } = await admin.storage.from(BUCKET).list(prefix)
      if (error) throw error
      if (objects?.length) {
        const { error: removeError } = await admin.storage.from(BUCKET).remove(objects.map((o) => `${prefix}/${o.name}`))
        if (removeError) throw removeError
      }
      const { data: left } = await admin.storage.from(BUCKET).list(prefix)
      if (left?.length) throw new Error(`${left.length} file(s) left under ${prefix}`)
    }
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
      const { data } = await admin.auth.admin.getUserById(qaUserId)
      if (data?.user) throw new Error("still resolvable after delete")
    })
  }
  if (problems.length > 0) {
    console.log("Cleanup INCOMPLETE:")
    for (const p of problems) console.log(`  - ${p}`)
  } else {
    console.log("Cleanup verified: this run's clients, projects, evidence rows and files, exports, membership, MFA factor and auth user are all gone.")
  }
  return problems
}

const projectIds = []

async function main() {
  console.log(`Evidence acceptance run ${runId}\n`)
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
  console.log("Signed in at aal2 (password + TOTP).\n")

  const { data: clientRow, error: clientError } = await client
    .from("client_businesses")
    .insert({ workspace_id: workspace.id, display_name: `${PREFIX}${runId}`, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  if (clientError) throw clientError
  clientIds.push(clientRow.id)
  const newProject = async (name) => {
    const { data, error } = await client
      .from("projects")
      .insert({ workspace_id: workspace.id, client_business_id: clientRow.id, project_name: `${PREFIX}${runId} ${name}`, project_type: "SEO", lifecycle_status: "ACTIVE", default_currency: "BDT", timezone: "Asia/Dhaka" })
      .select("id, project_name")
      .single()
    if (error) throw error
    projectIds.push(data.id)
    return data
  }
  const p1 = await newProject("P1")
  const p2 = await newProject("P2")
  const pathFor = (projectId, ext = "png") => `${workspace.id}/${projectId}/${crypto.randomUUID()}.${ext}`
  /** What the app does: a signed upload URL from the server, then the upload from the Owner's own session. */
  const upload = async (path, body, contentType) => {
    const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
    if (signError) return { error: signError }
    return client.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, body, { contentType })
  }
  const prepare = (projectId, filename, size) =>
    client.rpc("prepare_evidence_upload", { p_project_id: projectId, p_original_filename: filename, p_size_bytes: size })
  /** What the server records after downloading and checking the bytes (service role only). */
  const verify = (caller, projectId, uploadId, { sha = sha256(PNG), size = PNG.length, type = "image/png" } = {}) =>
    caller.rpc("record_evidence_upload_verification", {
      p_upload_id: uploadId,
      p_project_id: projectId,
      p_sha256: sha,
      p_size_bytes: size,
      p_content_type: type,
    })
  const discard = (caller, projectId, uploadId) =>
    caller.rpc("discard_evidence_upload", { p_upload_id: uploadId, p_project_id: projectId, p_reason: "QA discard" })
  const attach = (projectId, uploadId) =>
    client.rpc("add_evidence_attachment", {
      p_project_id: projectId,
      p_upload_id: uploadId,
      p_category: "evidence",
      p_verification_status: "OWNER_REPORTED",
    })
  const exists = async (path) => {
    const slash = path.lastIndexOf("/")
    const { data } = await admin.storage.from(BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1) })
    return (data ?? []).some((o) => o.name === path.slice(slash + 1))
  }
  /** The app's processor (src/lib/evidence/storage-cleanup.ts), step for step. */
  const processQueue = async (storage = admin.storage) => {
    const { data: items, error } = await admin.rpc("claim_storage_cleanup", { p_limit: 50 })
    if (error) throw new Error(`claim_storage_cleanup: ${error.message}`)
    const run = { claimedPaths: items.map((i) => i.storage_path), deletedPaths: [], failed: 0 }
    for (const item of items) {
      let failure = null
      const { data: removed, error: removeError } = await storage.from(item.bucket_id).remove([item.storage_path])
      if (removeError) failure = removeError.message || "storage delete failed"
      else if (!(removed ?? []).length) {
        const slash = item.storage_path.lastIndexOf("/")
        const name = item.storage_path.slice(slash + 1)
        const { data: listed, error: listError } = await storage.from(item.bucket_id).list(item.storage_path.slice(0, slash), { search: name })
        if (listError) failure = `could not confirm the deletion: ${listError.message}`
        else if ((listed ?? []).some((o) => o.name === name)) failure = "the file is still stored after the delete"
      }
      await admin.rpc("complete_storage_cleanup", { p_id: item.id, p_error: failure ?? undefined })
      if (failure) run.failed += 1
      else run.deletedPaths.push(item.storage_path)
    }
    return run
  }

  // --- 1. The bucket ------------------------------------------------------------
  console.log("Step 1: the evidence bucket is private and enforces type and size")
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(BUCKET)
  check("the bucket exists", !bucketError && !!bucket, bucketError?.message)
  check("it is private", bucket?.public === false)
  check("it limits files to 25 MB", Number(bucket?.file_size_limit) === LIMIT, String(bucket?.file_size_limit))
  check(
    "it allows exactly the eight spec types",
    JSON.stringify([...(bucket?.allowed_mime_types ?? [])].sort()) ===
      JSON.stringify([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/png",
        "image/webp",
        "text/csv",
        "video/mp4",
      ]),
    JSON.stringify(bucket?.allowed_mime_types)
  )

  // --- 2. No direct access ----------------------------------------------------------
  console.log("\nStep 2: nobody uploads, reads or deletes evidence files directly")
  const directPath = pathFor(p1.id)
  await rejects("the Owner can't upload without a signed URL", client.storage.from(BUCKET).upload(directPath, PNG, { contentType: "image/png" }))
  await rejects("anon can't upload", anon.storage.from(BUCKET).upload(pathFor(p1.id), PNG, { contentType: "image/png" }))
  await rejects("a disallowed type is refused by the bucket", upload(pathFor(p1.id, "html"), Buffer.from("<script>x</script>"), "text/html"))
  await rejects("a file over 25 MB is refused by the bucket", upload(pathFor(p1.id, "pdf"), Buffer.alloc(LIMIT + 1024, 0x25), "application/pdf"))

  const goodPath = pathFor(p1.id)
  const { error: uploadError } = await upload(goodPath, PNG, "image/png")
  check("a signed upload of an allowed file works", !uploadError, uploadError?.message)
  await rejects("the Owner can't download it directly", client.storage.from(BUCKET).download(goodPath))
  await rejects("anon can't download it", anon.storage.from(BUCKET).download(goodPath))
  const { data: listed } = await client.storage.from(BUCKET).list(`${workspace.id}/${p1.id}`)
  check("the Owner can't list the bucket", !listed || listed.length === 0, JSON.stringify(listed))
  await client.storage.from(BUCKET).remove([goodPath])
  const { data: stillThere } = await admin.storage.from(BUCKET).list(`${workspace.id}/${p1.id}`)
  check("the Owner can't delete it directly", (stillThere ?? []).some((o) => goodPath.endsWith(o.name)))

  // --- 3. Recording needs the server's verification ------------------------------------
  console.log("\nStep 3: an attachment is recorded only from a server-verified upload")
  await rejects("a disallowed type gets no upload", prepare(p1.id, "page.html", 10), /type is not allowed/)
  await rejects("an empty file gets no upload", prepare(p1.id, "empty.png", 0), /between 1 byte and 25 MB/)
  await rejects("a file over 25 MB gets no upload", prepare(p1.id, "big.pdf", LIMIT + 1), /between 1 byte and 25 MB/)
  await rejects("anon can't prepare uploads", anon.rpc("prepare_evidence_upload", { p_project_id: p1.id, p_original_filename: "x.png", p_size_bytes: 10 }))
  const { data: u1, error: u1Error } = await prepare(p1.id, "screenshot.png", PNG.length)
  check(
    "the database records the upload and generates its path",
    !u1Error && u1?.storage_path === `${workspace.id}/${p1.id}/${u1?.upload_id}.png` && u1?.content_type === "image/png",
    u1Error?.message ?? JSON.stringify(u1)
  )
  const { error: u1UploadError } = await upload(u1.storage_path, PNG, "image/png")
  check("the file is uploaded to that path", !u1UploadError, u1UploadError?.message)
  await rejects("it can't be recorded before the server checked it", attach(p1.id, u1.upload_id), /has not passed the server's checks/)

  // The review's reproduction: PNG bytes stored as a .pdf, a false hash.
  const { data: forgedUpload } = await prepare(p1.id, "statement.pdf", PNG.length)
  await upload(forgedUpload.storage_path, PNG, "application/pdf")
  await rejects(
    "the old call with caller-supplied type and hash no longer exists",
    client.rpc("add_evidence_attachment", {
      p_project_id: p1.id,
      p_category: "evidence",
      p_storage_path: forgedUpload.storage_path,
      p_original_filename: "statement.pdf",
      p_content_type: "application/pdf",
      p_size_bytes: PNG.length,
      p_sha256: "0".repeat(64),
    })
  )
  await rejects("the Owner can't record a verification result", verify(client, p1.id, forgedUpload.upload_id, { sha: "0".repeat(64), type: "application/pdf" }))
  await rejects("anon can't record a verification result", verify(anon, p1.id, forgedUpload.upload_id, { sha: "0".repeat(64), type: "application/pdf" }))
  await rejects("the Owner can't mark an upload verified directly", client.from("evidence_uploads").update({ status: "VERIFIED" }).eq("id", forgedUpload.upload_id).select())
  await rejects("so the forged .pdf can't be recorded", attach(p1.id, forgedUpload.upload_id), /has not passed the server's checks/)

  await rejects("a verification with the wrong size is refused", verify(admin, p1.id, u1.upload_id, { size: PNG.length + 1 }), /does not match/)
  await rejects("a verification with another type is refused", verify(admin, p1.id, u1.upload_id, { type: "application/pdf" }), /checked type does not match/)
  await rejects("a verification for another project is refused", verify(admin, p2.id, u1.upload_id), /unknown upload/)
  check("the server's verification is recorded", !(await verify(admin, p1.id, u1.upload_id)).error)
  await rejects("it can't be verified twice", verify(admin, p1.id, u1.upload_id), /upload is verified/)
  await rejects("it can't be recorded on another project", attach(p2.id, u1.upload_id), /unknown upload/)
  await rejects("anon can't record attachments", anon.rpc("add_evidence_attachment", { p_project_id: p1.id, p_upload_id: u1.upload_id, p_category: "evidence" }))
  const { data: a1, error: a1Error } = await attach(p1.id, u1.upload_id)
  check(
    "the verified upload is recorded with the server's hash, size and type",
    !a1Error && a1?.storage_path === u1.storage_path && a1.sha256 === sha256(PNG) && a1.size_bytes === PNG.length &&
      a1.content_type === "image/png" && a1.original_filename === "screenshot.png",
    a1Error?.message ?? JSON.stringify(a1)
  )
  const a1Path = u1.storage_path
  const { data: replayed, error: replayError } = await attach(p1.id, u1.upload_id)
  check("recording it again returns the same item (idempotent)", !replayError && replayed?.id === a1.id, replayError?.message)
  const a1Count = await mustCount(admin.from("evidence_items").select("id", { count: "exact", head: true }).eq("storage_path", a1Path), "a1 rows")
  check("and records nothing new", a1Count === 1)

  // A verified object that changed afterwards is refused (test control: the
  // database owner edits the object's version; nobody else can touch it).
  const { data: u2 } = await prepare(p1.id, "second.png", PNG.length)
  await upload(u2.storage_path, PNG, "image/png")
  check("a second upload is verified", !(await verify(admin, p1.id, u2.upload_id)).error)
  runOwnerSql([`update storage.objects set version = 'tampered' where bucket_id = 'evidence' and name = '${u2.storage_path}';`])
  await rejects("an object changed after the check is refused", attach(p1.id, u2.upload_id), /changed after it was checked/)

  // --- 4. Discarding and the deletion queue ----------------------------------------------
  console.log("\nStep 4: files are deleted only through the queue, and never while referenced")
  await rejects("a recorded upload can't be discarded", discard(admin, p1.id, u1.upload_id), /recorded and cannot be discarded/)
  await rejects("the Owner can't discard uploads", discard(client, p1.id, forgedUpload.upload_id))
  await rejects("the Owner can't claim queue work", client.rpc("claim_storage_cleanup", { p_limit: 10 }))
  await rejects("the Owner can't complete queue work", client.rpc("complete_storage_cleanup", { p_id: 1 }))
  await rejects("the Owner can't write to the queue", client.from("storage_cleanup_queue").insert({ workspace_id: workspace.id, storage_path: a1Path, reason: "x" }).select())
  check("the forged .pdf upload is discarded", !(await discard(admin, p1.id, forgedUpload.upload_id)).error)
  await rejects("a discarded upload can't be verified", verify(admin, p1.id, forgedUpload.upload_id, { type: "application/pdf" }), /upload is discarded/)
  await rejects("or recorded", attach(p1.id, forgedUpload.upload_id), /has not passed the server's checks/)
  // Test control: a queue row for the recorded file, as a bug might write.
  runOwnerSql([
    `insert into public.storage_cleanup_queue (workspace_id, project_id, storage_path, reason) values ('${workspace.id}', '${p1.id}', '${a1Path}', 'QA: referenced path');`,
  ])
  const firstRun = await processQueue()
  check("the queue deleted the discarded upload's file", firstRun.deletedPaths.includes(forgedUpload.storage_path) && !(await exists(forgedUpload.storage_path)))
  check("it never hands out a path an evidence row uses", !firstRun.claimedPaths.includes(a1Path) && (await exists(a1Path)))
  const { data: skipped } = await admin.from("storage_cleanup_queue").select("outcome").eq("storage_path", a1Path).single()
  check("that queue row is settled as skipped", skipped?.outcome === "SKIPPED_REFERENCED", JSON.stringify(skipped))

  // Uploads left open for 24 hours expire and are queued (test control: backdated).
  const { data: u3 } = await prepare(p1.id, "abandoned.png", PNG.length)
  await upload(u3.storage_path, PNG, "image/png")
  runOwnerSql([`update public.evidence_uploads set created_at = now() - interval '25 hours' where id = '${u3.upload_id}';`])
  const expiryRun = await processQueue()
  const { data: u3After } = await admin.from("evidence_uploads").select("status").eq("id", u3.upload_id).single()
  check("an upload left open for 24 hours expires", u3After?.status === "EXPIRED", JSON.stringify(u3After))
  check("and its file is deleted", expiryRun.deletedPaths.includes(u3.storage_path) && !(await exists(u3.storage_path)))
  await rejects("an expired upload can't be recorded", attach(p1.id, u3.upload_id), /has not passed the server's checks/)

  console.log("\n  Removing evidence that is in no export")
  const { data: link1 } = await client.rpc("add_evidence_item", { p_project_id: p1.id, p_category: "evidence", p_external_url: `https://example.com/${runId}/a`, p_verification_status: "OWNER_REPORTED" })
  await rejects("removal needs a reason", client.rpc("remove_evidence_item", { p_item_id: link1.id, p_project_id: p1.id, p_reason: "  " }), /give a reason/)
  const { data: delResult, error: delError } = await client.rpc("remove_evidence_item", { p_item_id: link1.id, p_project_id: p1.id, p_reason: "Wrong link" })
  check("unexported evidence is deleted", !delError && delResult?.outcome === "DELETED", delError?.message ?? JSON.stringify(delResult))
  const link1Left = await mustCount(admin.from("evidence_items").select("id", { count: "exact", head: true }).eq("id", link1.id), "link1")
  check("its row is gone", link1Left === 0)
  await rejects("the old hard-delete RPC no longer exists", client.rpc("delete_evidence_item", { p_item_id: a1.id, p_project_id: p1.id }))

  const { data: u4 } = await prepare(p1.id, "temporary.png", PNG.length)
  await upload(u4.storage_path, PNG, "image/png")
  await verify(admin, p1.id, u4.upload_id)
  const { data: a4 } = await attach(p1.id, u4.upload_id)
  const { data: del4, error: del4Error } = await client.rpc("remove_evidence_item", { p_item_id: a4.id, p_project_id: p1.id, p_reason: "Wrong file" })
  check("an unexported attachment is deleted", !del4Error && del4?.outcome === "DELETED", del4Error?.message)
  const { data: queued4 } = await admin.from("storage_cleanup_queue").select("reason, completed_at").eq("storage_path", u4.storage_path).single()
  check("its file was queued in the same transaction", queued4?.reason === "evidence deleted" && queued4.completed_at === null, JSON.stringify(queued4))
  const run4 = await processQueue()
  check("and the queue deletes it", run4.deletedPaths.includes(u4.storage_path) && !(await exists(u4.storage_path)))

  // A failed deletion stays queued with its error and is retried (test
  // control: a Storage outage, simulated with a client whose key is invalid).
  const { data: u6 } = await prepare(p1.id, "outage.png", PNG.length)
  await upload(u6.storage_path, PNG, "image/png")
  check("an upload is discarded", !(await discard(admin, p1.id, u6.upload_id)).error)
  const brokenStorage = createClient(SUPABASE_URL, "invalid-key", { auth: { persistSession: false } }).storage
  const failRun = await processQueue(brokenStorage)
  const { data: failing } = await admin.from("storage_cleanup_queue").select("id, attempts, last_error, completed_at").eq("storage_path", u6.storage_path).single()
  check(
    "a failed deletion stays queued with its error",
    failRun.failed >= 1 && failing?.completed_at === null && failing.attempts === 1 && !!failing.last_error && (await exists(u6.storage_path)),
    JSON.stringify(failing)
  )
  const { data: visibleQueue } = await client.from("storage_cleanup_queue").select("id, last_error").is("completed_at", null).eq("project_id", p1.id)
  check("the Owner can see it pending, with the error", (visibleQueue ?? []).some((q) => q.id === failing.id && !!q.last_error))
  const retryRun = await processQueue()
  const { data: retried } = await admin.from("storage_cleanup_queue").select("attempts, outcome").eq("id", failing.id).single()
  check(
    "the next run retries and deletes it",
    retryRun.deletedPaths.includes(u6.storage_path) && retried?.attempts === 2 && retried.outcome === "DELETED" && !(await exists(u6.storage_path)),
    JSON.stringify(retried)
  )

  // --- 5. Retention once exported ---------------------------------------------------------------
  console.log("\nStep 5: evidence that is part of an export is kept")
  const { data: link2 } = await client.rpc("add_evidence_item", { p_project_id: p1.id, p_category: "reports", p_external_url: `https://example.com/${runId}/b`, p_verification_status: "VERIFIED" })
  // Test control: an export row as approve_and_export_project would write it.
  runOwnerSql([
    `insert into public.project_exports (workspace_id, project_id, version, content, evidence_index_content, export_manifest_content) values ('${workspace.id}', '${p1.id}', 1, '# QA', '# QA index', '# QA manifest');`,
  ])
  const { data: exportRow } = await admin.from("project_exports").select("id").eq("project_id", p1.id).eq("version", 1).single()
  const { data: recorded } = await client.from("project_export_evidence").select("evidence_item_id").eq("export_id", exportRow.id)
  check(
    "the export recorded exactly the evidence it was made from",
    JSON.stringify((recorded ?? []).map((r) => r.evidence_item_id).sort()) === JSON.stringify([a1.id, link2.id].sort()),
    JSON.stringify(recorded)
  )
  const { data: keepResult, error: keepError } = await client.rpc("remove_evidence_item", { p_item_id: a1.id, p_project_id: p1.id, p_reason: "Superseded by a newer screenshot" })
  check("exported evidence is kept when removed", !keepError && keepResult?.outcome === "RETAINED" && keepResult?.storage_path === null, keepError?.message ?? JSON.stringify(keepResult))
  const { data: a1After } = await admin.from("evidence_items").select("removed_at, removed_by, removal_reason, storage_path").eq("id", a1.id).single()
  check("it is marked removed with actor and reason", !!a1After?.removed_at && a1After.removed_by === qaUserId && a1After.removal_reason === "Superseded by a newer screenshot")
  const { data: fileStill } = await admin.storage.from(BUCKET).download(a1Path)
  check("its file is still stored, unchanged", !!fileStill && sha256(Buffer.from(await fileStill.arrayBuffer())) === sha256(PNG))
  await rejects("it can't be removed twice", client.rpc("remove_evidence_item", { p_item_id: a1.id, p_project_id: p1.id, p_reason: "again" }), /already removed/)
  const { data: snapshot } = await client.rpc("get_project_export_snapshot", { p_project_id: p1.id })
  check("removed evidence is left out of the next export", snapshot?.evidence?.length === 1 && snapshot.evidence[0].external_url?.endsWith("/b"), JSON.stringify(snapshot?.evidence))
  ownerSqlRejects("even the database owner can't delete exported evidence", [`delete from public.evidence_items where id = '${link2.id}';`], /part of an export and is kept/)
  ownerSqlRejects("removed evidence can't be changed", [`update public.evidence_items set notes = 'edited' where id = '${a1.id}';`], /removed evidence is kept as history/)
  ownerSqlRejects("a file can't be swapped under an evidence row", [`update public.evidence_items set sha256 = repeat('0', 64) where id = '${a1.id}';`], /removed evidence|cannot be replaced/)
  await rejects("the export's evidence list can't be edited", admin.from("project_export_evidence").delete().eq("export_id", exportRow.id))

  // --- 6. Export archiving ---------------------------------------------------------------------
  console.log("\nStep 6: an export can be archived and restored, never deleted")
  const archive = (archived, reason) => client.rpc("set_export_archived", { p_export_id: exportRow.id, p_archived: archived, p_reason: reason })
  await rejects("restoring an export that isn't archived is refused", archive(false, "x"), /not archived/)
  for (const blank of [undefined, "", "   "]) {
    await rejects(`archiving needs a reason (${JSON.stringify(blank)})`, archive(true, blank), /give a reason for archiving/)
  }
  check("archive an export", !(await archive(true, "Superseded")).error)
  await rejects("archiving twice is refused", archive(true, "again"), /already archived/)
  await rejects("restoring needs a reason", archive(false, " "), /give a reason for restoring/)
  check("restore it", !(await archive(false, "Needed again")).error)
  const { data: events } = await client.from("project_export_archive_events").select("event_type, reason, actor_id").eq("export_id", exportRow.id).order("seq")
  check(
    "both changes are on record with actor and reason",
    JSON.stringify(events?.map((e) => `${e.event_type}:${e.reason}`)) === JSON.stringify(["ARCHIVED:Superseded", "RESTORED:Needed again"]) &&
      events.every((e) => e.actor_id === qaUserId),
    JSON.stringify(events)
  )
  await rejects("archive events can't be edited", admin.from("project_export_archive_events").update({ reason: "x" }).eq("export_id", exportRow.id))
  await rejects("anon can't archive exports", anon.rpc("set_export_archived", { p_export_id: exportRow.id, p_archived: true }))
  await rejects("the service role can't delete an export", admin.from("project_exports").delete().eq("id", exportRow.id))

  // --- 7. Archived projects ----------------------------------------------------------------------
  console.log("\nStep 7: an archived project takes no new files")
  const { data: u5 } = await prepare(p2.id, "late.png", PNG.length)
  await upload(u5.storage_path, PNG, "image/png")
  check("a P2 upload is verified before archiving", !(await verify(admin, p2.id, u5.upload_id)).error)
  check("P2 archived", !(await client.rpc("set_project_lifecycle", { p_project_id: p2.id, p_to_status: "ARCHIVED" })).error)
  await rejects("no upload is prepared for an archived project", prepare(p2.id, "x.png", 10), /archived and read-only/)
  await rejects("a verified upload can't be recorded once its project is archived", attach(p2.id, u5.upload_id), /archived/)
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
