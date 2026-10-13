import { execFileSync } from "node:child_process"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHmac, randomBytes } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var for e2e: ${name} (expected in .env.local, or the RG_ENV_FILE file)`)
  return value
}

export const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL")
export const ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY")

export const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Must match the filter in scripts/qa-purge-fixtures.sql. */
/**
 * Runs a SQL file with `supabase db query --linked`, only if the CLI is
 * linked to the project this run uses (see scripts/lib/qa-fixtures.mjs).
 */
function runLinkedSql(path: string) {
  const linked = readFileSync("supabase/.temp/project-ref", "utf8").trim()
  const target = new URL(SUPABASE_URL).hostname.split(".")[0]
  if (linked !== target) {
    throw new Error(`the Supabase CLI is linked to ${linked}, but this run uses ${target}: run \`npx supabase link --project-ref ${target}\` first`)
  }
  execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", path], { stdio: "pipe", shell: true })
}

export const QA_CLIENT_PREFIX = "Vera Wellness QA "

// ---------------------------------------------------------------------
// TOTP (RFC 6238). The secret comes from the app's own enrollment screen,
// read out of the page exactly as a person would type it into an
// authenticator app.
// ---------------------------------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "")) {
    const val = alphabet.indexOf(char)
    if (val === -1) throw new Error(`invalid base32 character: ${char}`)
    bits += val.toString(2).padStart(5, "0")
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function totpForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 1_000_000).padStart(6, "0")
}

const usedSteps = new Map<string, Set<number>>()

/**
 * A code from a 30s step not used before for this secret, and not in the
 * last 3s of its step (so it doesn't expire in flight). Waits if needed --
 * a real authenticator user would do the same rather than resubmit a
 * just-used code.
 */
export async function freshTotp(secret: string): Promise<string> {
  const used = usedSteps.get(secret) ?? new Set<number>()
  usedSteps.set(secret, used)
  for (;;) {
    const now = Date.now()
    const step = Math.floor(now / 30_000)
    if (!used.has(step) && now % 30_000 < 27_000) {
      used.add(step)
      return totpForStep(secret, step)
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
}

// ---------------------------------------------------------------------
// Throwaway Owner-role account.
// ---------------------------------------------------------------------

export type QaOwner = { email: string; password: string; userId: string }

export async function createQaOwner(runId: string): Promise<QaOwner> {
  const { data: workspace, error: wsError } = await admin.from("workspaces").select("id").limit(1).single()
  if (wsError || !workspace) throw new Error("no workspace found -- run bootstrap-workspace.mjs first")

  const email = `qa-e2e-playwright-${runId}@resultgriddigital.internal`
  const password = `Qa-${randomBytes(12).toString("hex")}!Aa1`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser returned no user")

  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: data.user.id, role: "OWNER" })
  if (memberError) throw memberError

  return { email, password, userId: data.user.id }
}

/** A supabase-js session for the same QA user at aal2, used only to seed data through the app's RPCs. */
export async function signInAtAal2(owner: QaOwner, totpSecret: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email: owner.email, password: owner.password })
  if (signInError) throw signInError
  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors()
  if (factorsError) throw factorsError
  const factor = factors.totp.find((f) => f.status === "verified")
  if (!factor) throw new Error("QA user has no verified TOTP factor -- browser enrollment must run first")
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: await freshTotp(totpSecret),
  })
  if (verifyError) throw verifyError
  return client
}

// ---------------------------------------------------------------------
// Teardown, with every step verified rather than assumed.
// ---------------------------------------------------------------------

export type CleanupReport = {
  qaClientsRemaining: number
  qaProjectsRemaining: number
  workspaceMembershipsRemaining: number
  mfaFactorsRemaining: number
  authUser: "HARD_DELETED" | "SOFT_DELETED" | "NOT_DELETED"
  authUserDetail: string
}

/** An exact count, or a thrown error: a failed check must never read as "0 left". */
async function mustCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string
): Promise<number> {
  const { count, error } = await query
  if (error) throw new Error(`verification query failed (${label}): ${error.message}`)
  if (typeof count !== "number") throw new Error(`verification query returned no count (${label})`)
  return count
}

/** Tables whose user triggers the QA purge turns off, inside its one transaction. */
const PURGE_TABLES = [
  "client_businesses",
  "projects",
  "project_answers",
  "evidence_items",
  "financial_records",
  "project_targets",
  "creatives",
  "client_share_links",
  "project_exports",
  "project_approval_events",
  "lifecycle_events",
  "creative_approval_history",
  "project_export_evidence",
  "project_export_archive_events",
  "evidence_uploads",
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Deletes ONLY these clients (and their projects, ledger, exports) and only
 * if they carry the QA prefix. The delete guards (immutable ledger/history, parents)
 * are disabled inside this one transaction; ALTER TABLE holds an exclusive
 * lock until commit, so no other session sees them off.
 */
async function purgeRunClients(clientIds: string[]) {
  if (clientIds.length === 0) return
  for (const id of clientIds) if (!UUID.test(id)) throw new Error(`refusing to purge non-UUID id: ${id}`)
  // Evidence files live in Storage, which SQL can't delete: collect their
  // paths first, delete them through the Storage API after the rows.
  const { data: purgeProjects, error: purgeProjectsError } = await admin.from("projects").select("id").in("client_business_id", clientIds)
  if (purgeProjectsError) throw new Error(`purge: could not list projects: ${purgeProjectsError.message}`)
  const purgeProjectIds = (purgeProjects ?? []).map((p: { id: string }) => p.id)
  const { data: purgeFiles, error: purgeFilesError } = purgeProjectIds.length
    ? await admin.from("evidence_items").select("storage_path").in("project_id", purgeProjectIds).not("storage_path", "is", null)
    : { data: [], error: null }
  if (purgeFilesError) throw new Error(`purge: could not list evidence files: ${purgeFilesError.message}`)
  // Uploads (pending, discarded or recorded) and queued deletions: removing
  // an object that is already gone is not an error.
  const { data: purgeUploads, error: purgeUploadsError } = purgeProjectIds.length
    ? await admin.from("evidence_uploads").select("storage_path").in("project_id", purgeProjectIds)
    : { data: [], error: null }
  if (purgeUploadsError) throw new Error(`purge: could not list evidence uploads: ${purgeUploadsError.message}`)
  const { data: purgeQueued, error: purgeQueuedError } = purgeProjectIds.length
    ? await admin.from("storage_cleanup_queue").select("storage_path").in("project_id", purgeProjectIds)
    : { data: [], error: null }
  if (purgeQueuedError) throw new Error(`purge: could not list queued file deletions: ${purgeQueuedError.message}`)
  const purgeFilePaths = [
    ...new Set(
      [...(purgeFiles ?? []), ...(purgeUploads ?? []), ...(purgeQueued ?? [])]
        .map((f: { storage_path: string | null }) => f.storage_path)
        .filter((p): p is string => !!p)
    ),
  ]
  const scoped = `select id from public.client_businesses where id in (${clientIds.map((id) => `'${id}'`).join(", ")}) and display_name like '${QA_CLIENT_PREFIX}%'`
  const sql = [
    "begin;",
    // Every user trigger (append-only guards, delete backstops, retention
    // guards) is off for these tables inside this one transaction only;
    // foreign-key cascades are system triggers and still run.
    ...PURGE_TABLES.map((t) => `alter table public.${t} disable trigger user;`),
    `delete from public.creative_approval_history where project_id in (select id from public.projects where client_business_id in (${scoped}));`,
    `delete from public.lifecycle_events where entity_id in (${scoped}) or entity_id in (select id from public.projects where client_business_id in (${scoped}));`,
    `delete from public.storage_cleanup_queue where project_id in (select id from public.projects where client_business_id in (${scoped}));`,
    `delete from public.projects where client_business_id in (${scoped});`,
    `delete from public.client_businesses where id in (${scoped});`,
    ...PURGE_TABLES.map((t) => `alter table public.${t} enable trigger user;`),
    "commit;",
  ].join("\n")
  const path = join(tmpdir(), `rg-e2e-purge-${Date.now()}.sql`)
  writeFileSync(path, sql)
  try {
    runLinkedSql(path)
  } finally {
    unlinkSync(path)
  }

  if (purgeFilePaths.length > 0) {
    const { error: removeError } = await admin.storage.from("evidence").remove(purgeFilePaths)
    if (removeError) throw new Error(`purge: could not delete evidence files: ${removeError.message}`)
  }
}

export async function cleanupQa(owner: QaOwner | null, clientIds: string[]): Promise<CleanupReport> {
  // This run's fixtures only, and first: removing its ledger rows is what
  // lets the user delete below go as far as it can.
  await purgeRunClients(clientIds)

  const qaClientsRemaining = clientIds.length
    ? await mustCount(
        admin.from("client_businesses").select("id", { count: "exact", head: true }).in("id", clientIds),
        "this run's clients"
      )
    : 0
  const qaProjectsRemaining = clientIds.length
    ? await mustCount(
        admin.from("projects").select("id", { count: "exact", head: true }).in("client_business_id", clientIds),
        "this run's projects"
      )
    : 0

  let workspaceMembershipsRemaining = 0
  let mfaFactorsRemaining = 0
  let authUser: CleanupReport["authUser"] = "NOT_DELETED"
  let authUserDetail = "no QA user was created"

  if (owner) {
    const { data: factorList, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: owner.userId })
    if (listError) throw new Error(`could not list MFA factors: ${listError.message}`)
    for (const f of factorList.factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: owner.userId })
      if (error) throw new Error(`could not delete MFA factor ${f.id}: ${error.message}`)
    }
    const { data: factorsAfter, error: relistError } = await admin.auth.admin.mfa.listFactors({ userId: owner.userId })
    if (relistError) throw new Error(`could not verify MFA factors: ${relistError.message}`)
    mfaFactorsRemaining = factorsAfter.factors.length

    const { error: memberDeleteError } = await admin.from("workspace_members").delete().eq("user_id", owner.userId)
    if (memberDeleteError) throw new Error(`could not delete membership: ${memberDeleteError.message}`)
    workspaceMembershipsRemaining = await mustCount(
      admin.from("workspace_members").select("id", { count: "exact", head: true }).eq("user_id", owner.userId),
      "workspace memberships"
    )

    const { error: hardError } = await admin.auth.admin.deleteUser(owner.userId)
    if (!hardError) {
      const { data: stillThere, error: lookupError } = await admin.auth.admin.getUserById(owner.userId)
      if (lookupError && lookupError.status !== 404) {
        throw new Error(`could not verify user deletion: ${lookupError.message}`)
      }
      authUser = stillThere?.user ? "NOT_DELETED" : "HARD_DELETED"
      authUserDetail = stillThere?.user ? "deleteUser reported success but the user still resolves" : "removed"
    } else {
      // Expected for this suite: the app's own login actions write
      // security_events rows for this user, and security_events.user_id is
      // ON DELETE SET NULL on an append-only table whose UPDATE guard
      // rejects that, so the audit trail pins the account. Soft delete
      // anonymizes the credentials instead -- verified below by trying them.
      const { error: softError } = await admin.auth.admin.deleteUser(owner.userId, true)
      if (softError) {
        authUser = "NOT_DELETED"
        authUserDetail = `hard delete failed (${hardError.message}); soft delete failed (${softError.message})`
      } else {
        // Two independent checks, each of which must positively confirm the
        // deletion; anything inconclusive (network, rate limit, server
        // error) throws instead of being read as success.
        const { data: deletedRow, error: rowError } = await admin.auth.admin.getUserById(owner.userId)
        if (rowError || !deletedRow?.user) {
          throw new Error(`could not read the soft-deleted user back: ${rowError?.message ?? "no user returned"}`)
        }
        const rowDeleted = deletedRow.user.deleted_at != null && deletedRow.user.email !== owner.email

        const probe = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
        const { data: signIn, error: signInError } = await probe.auth.signInWithPassword({
          email: owner.email,
          password: owner.password,
        })
        if (signInError && !(signInError.status === 400 && signInError.code === "invalid_credentials")) {
          throw new Error(
            `soft-delete sign-in probe was inconclusive (status ${signInError.status}, code ${signInError.code}): ${signInError.message}`
          )
        }
        const credentialsRejected = signInError !== null && signIn.session === null

        authUser = rowDeleted && credentialsRejected ? "SOFT_DELETED" : "NOT_DELETED"
        authUserDetail =
          authUser === "SOFT_DELETED"
            ? `hard delete failed (${hardError.message}); soft-deleted: deleted_at is set, the email is anonymized, and sign-in with the old credentials is rejected as invalid_credentials; row retained because its security_events audit rows reference it`
            : `soft delete reported success but deleted_at=${deletedRow.user.deleted_at ?? "null"}, email anonymized=${deletedRow.user.email !== owner.email}, old credentials rejected=${credentialsRejected}`
      }
    }
  }

  return {
    qaClientsRemaining,
    qaProjectsRemaining,
    workspaceMembershipsRemaining,
    mfaFactorsRemaining,
    authUser,
    authUserDetail,
  }
}

/**
 * Removes ONLY the given QA leads (name must carry the QA prefix) and their
 * archive history. Leads have no delete path in the app and their archive
 * events are append-only, so the guards are disabled inside this one
 * transaction, as purgeRunClients does. Returns how many are left.
 */
export async function purgeQaLeads(leadIds: string[]): Promise<number> {
  if (leadIds.length === 0) return 0
  for (const id of leadIds) if (!UUID.test(id)) throw new Error(`refusing to purge non-UUID lead id: ${id}`)
  const scoped = `select id from public.leads where id in (${leadIds.map((id) => `'${id}'`).join(", ")}) and name like '${QA_CLIENT_PREFIX}%'`
  const sql = [
    "begin;",
    "alter table public.leads disable trigger user;",
    "alter table public.lead_archive_events disable trigger user;",
    `delete from public.lead_archive_events where lead_id in (${scoped});`,
    `delete from public.leads where id in (${scoped});`,
    "alter table public.leads enable trigger user;",
    "alter table public.lead_archive_events enable trigger user;",
    "commit;",
  ].join("\n")
  const path = join(tmpdir(), `rg-e2e-leads-${Date.now()}.sql`)
  writeFileSync(path, sql)
  try {
    runLinkedSql(path)
  } finally {
    unlinkSync(path)
  }
  return mustCount(admin.from("leads").select("id", { count: "exact", head: true }).in("id", leadIds), "QA leads after purge")
}
