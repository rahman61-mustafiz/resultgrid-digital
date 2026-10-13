// Shared fixture helpers for the live QA scripts in scripts/.
import { execFileSync } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
 * An exact count, or a thrown error. A failed verification query must
 * never read as "0 rows remaining".
 */
export async function mustCount(query, label) {
  const { count, error } = await query
  if (error) throw new Error(`verification query failed (${label}): ${error.message}`)
  if (typeof count !== "number") throw new Error(`verification query returned no count (${label})`)
  return count
}

/** The fingerprint the export RPCs require, read the same way the app reads it. */
export async function currentFingerprint(client, projectId) {
  const { data, error } = await client.rpc("get_project_export_snapshot", { p_project_id: projectId })
  if (error) throw new Error(`get_project_export_snapshot failed: ${error.message}`)
  if (!data?.fingerprint) throw new Error("get_project_export_snapshot returned no fingerprint")
  return data.fingerprint
}

/**
 * Removes ONLY the given client_businesses (and their projects, ledger and
 * exports), and only if their display_name carries the QA prefix. The
 * ledger/export/history and parent-delete guards are disabled inside this one transaction;
 * ALTER TABLE holds an exclusive lock until commit, so no other session
 * ever sees the guards off. Then verifies, with errors surfaced, that
 * nothing is left.
 */
export async function purgeQaClients(admin, clientIds, namePrefix) {
  if (clientIds.length === 0) return
  for (const id of clientIds) {
    if (!UUID.test(id)) throw new Error(`refusing to purge non-UUID client id: ${id}`)
  }
  if (!/^[A-Za-z0-9 ]+ $/.test(namePrefix)) throw new Error(`unexpected QA name prefix: ${namePrefix}`)

  // Evidence files live in Storage, which SQL can't delete: collect their
  // paths first, delete them through the Storage API after the rows.
  const { data: purgeProjects, error: purgeProjectsError } = await admin.from("projects").select("id").in("client_business_id", clientIds)
  if (purgeProjectsError) throw new Error(`purge: could not list projects: ${purgeProjectsError.message}`)
  const purgeProjectIds = (purgeProjects ?? []).map((p) => p.id)
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
    ...new Set([...(purgeFiles ?? []), ...(purgeUploads ?? []), ...(purgeQueued ?? [])].map((f) => f.storage_path).filter((p) => !!p)),
  ]
  const idList = clientIds.map((id) => `'${id}'`).join(", ")
  const scoped = `select id from public.client_businesses where id in (${idList}) and display_name like '${namePrefix}%'`
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

  const path = join(tmpdir(), `rg-qa-purge-${Date.now()}-${process.pid}.sql`)
  writeFileSync(path, sql)
  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", path], { stdio: "pipe", shell: true })
  } finally {
    unlinkSync(path)
  }

  if (purgeFilePaths.length > 0) {
    const { error: removeError } = await admin.storage.from("evidence").remove(purgeFilePaths)
    if (removeError) throw new Error(`purge: could not delete evidence files: ${removeError.message}`)
  }

  const clientsLeft = await mustCount(
    admin.from("client_businesses").select("id", { count: "exact", head: true }).in("id", clientIds),
    "QA client_businesses after purge"
  )
  const projectsLeft = await mustCount(
    admin.from("projects").select("id", { count: "exact", head: true }).in("client_business_id", clientIds),
    "QA projects after purge"
  )
  if (clientsLeft !== 0 || projectsLeft !== 0) {
    throw new Error(`purge incomplete: ${clientsLeft} client(s), ${projectsLeft} project(s) left`)
  }
}

/**
 * Removes QA leads (name must start with the QA prefix) and their archive
 * history. lead_archive_events is append-only, so its guard triggers are
 * disabled inside this one transaction, as purgeQaClients does. Returns how
 * many of the given leads remain (0 on success).
 */
export async function purgeQaLeads(admin, leadIds, namePrefix) {
  if (leadIds.length === 0) return 0
  for (const id of leadIds) if (!UUID.test(id)) throw new Error(`refusing to purge non-UUID lead id: ${id}`)
  if (!/^[A-Za-z0-9 ]+ $/.test(namePrefix)) throw new Error(`unexpected QA name prefix: ${namePrefix}`)
  const scoped = `select id from public.leads where id in (${leadIds.map((id) => `'${id}'`).join(", ")}) and name like '${namePrefix}%'`
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
  const path = join(tmpdir(), `rg-qa-leads-${Date.now()}.sql`)
  writeFileSync(path, sql)
  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", path], { stdio: "pipe", shell: true })
  } finally {
    unlinkSync(path)
  }
  return mustCount(admin.from("leads").select("id", { count: "exact", head: true }).in("id", leadIds), "QA leads after purge")
}
