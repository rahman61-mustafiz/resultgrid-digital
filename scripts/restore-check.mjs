#!/usr/bin/env node
/**
 * Restores a backup made by scripts/backup-database.mjs into the LOCAL
 * Supabase stack (Docker) and checks it against the backup's manifest.
 * Never touches a hosted project.
 *
 *   npx supabase start            # local stack; applies supabase/migrations
 *   node scripts/restore-check.mjs backups/<timestamp>
 *
 * Steps, as in DEPLOYMENT.md "Backups":
 *   1. Verify every backup file against manifest.json (size + SHA-256).
 *   2. Empty the local database's data (schema comes from the migrations,
 *      which must match the backed-up project's), then load data.sql in
 *      one transaction with triggers off (session_replication_role =
 *      replica), so the append-only guards don't refuse historical rows.
 *   3. Upload every Storage object to the local stack.
 *   4. Compare: row count of every public table, every Storage object's
 *      SHA-256 after download, and that the guards are back on (an UPDATE
 *      to an approval-history row is refused).
 */
import { createClient } from "@supabase/supabase-js"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const dir = process.argv[2]
if (!dir || !existsSync(join(dir, "manifest.json"))) {
  console.error("usage: node scripts/restore-check.mjs backups/<timestamp>")
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))

let failures = 0
let passes = 0
function check(label, ok, detail) {
  if (ok) passes += 1
  else failures += 1
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` -- ${detail}`}`)
}

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true }))
const API_URL = status.API_URL
const SERVICE_KEY = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY
if (!API_URL?.includes("127.0.0.1") && !API_URL?.includes("localhost")) {
  console.error(`Refusing: the restore target is not local (${API_URL}).`)
  process.exit(1)
}
const projectId = readFileSync("supabase/config.toml", "utf8").match(/^project_id\s*=\s*"([^"]+)"/m)[1]
const dbContainer = `supabase_db_${projectId}`

function psql(sqlText) {
  return execFileSync("docker", ["exec", "-i", dbContainer, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], {
    input: sqlText,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1 << 30,
  })
}

console.log(`Restore check of ${dir} (backup of ${manifest.projectRef}, ${manifest.createdAt}) into ${API_URL}\n`)

console.log("1. Backup files match the manifest")
for (const [file, meta] of Object.entries(manifest.files)) {
  const buf = readFileSync(join(dir, file))
  check(file, buf.length === meta.bytes && createHash("sha256").update(buf).digest("hex") === meta.sha256)
}

console.log("\n2. Load data.sql into the local database")
// Only the app's data is restored: every public table, plus the Auth rows
// a person needs to sign in (account, identity, TOTP factor). Supabase's
// own internals (sessions and tokens, Storage's tables) are versioned by
// the platform and may not match the target's version; sessions are not
// restored, so everyone signs in again. Storage files are uploaded in
// step 3, which recreates their storage.objects rows.
const KEEP_AUTH = new Set(['"auth"."users"', '"auth"."identities"', '"auth"."mfa_factors"'])
const keep = (table) => table.startsWith('"public".') || KEEP_AUTH.has(table)
const fullDump = readFileSync(join(dir, "data.sql"), "utf8")
const blocks = [...fullDump.matchAll(/^COPY ("[^"]+"\."[^"]+")[^\n]*\n[\s\S]*?^\\\.$/gm)]
const loaded = blocks.map((m) => m[1]).filter(keep)
const data = [
  ...blocks.filter((m) => keep(m[1])).map((m) => m[0]),
  ...[...fullDump.matchAll(/^SELECT pg_catalog\.setval\('("[^"]+"\."[^"]+")'.*$/gm)].filter((m) => m[1].startsWith('"public".')).map((m) => m[0]),
].join("\n")
const truncate = `truncate ${loaded.join(", ")} cascade;`
console.log(`  (${loaded.length} of ${blocks.length} tables in data.sql: public + ${[...KEEP_AUTH].join(", ")})`)
try {
  psql(`begin;\nset session_replication_role = replica;\nselect pg_catalog.set_config('search_path', '', false);\n${truncate}\n${data}\nset session_replication_role = origin;\ncommit;\n`)
  check("data.sql loaded in one transaction", true)
} catch (err) {
  check("data.sql loaded in one transaction", false, String(err.stderr ?? err.message).split("\n").slice(0, 5).join(" | "))
}

const admin = createClient(API_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

console.log("\n3. Storage objects")
for (const bucket of Object.keys(manifest.storageObjects)) {
  const prefix = `storage/${bucket}/`
  for (const [file, meta] of Object.entries(manifest.files).filter(([f]) => f.startsWith(prefix))) {
    const path = file.slice(prefix.length)
    const { error } = await admin.storage.from(bucket).upload(path, readFileSync(join(dir, file)), { upsert: true })
    if (error) {
      check(`upload ${bucket}/${path}`, false, error.message)
      continue
    }
    const { data: blob, error: dlError } = await admin.storage.from(bucket).download(path)
    const hash = blob ? createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex") : null
    check(`${bucket}/${path} restored byte for byte`, !dlError && hash === meta.sha256, dlError?.message)
  }
  if (manifest.storageObjects[bucket] === 0) console.log(`  (bucket ${bucket} had no objects)`)
}

console.log("\n4. Restored data matches the backup")
for (const [table, expected] of Object.entries(manifest.rowCounts)) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true })
  check(`${table}: ${expected} rows`, !error && count === expected, error ? error.message : `got ${count}`)
}
const [enabledTriggers, disabledTriggers] = psql(`
  select count(*) filter (where t.tgenabled = 'O'), count(*) filter (where t.tgenabled = 'D')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal;
`).trim().split("|").map(Number)
check(`guard triggers on public tables are enabled (${enabledTriggers} on, ${disabledTriggers} off)`, enabledTriggers > 0 && disabledTriggers === 0)
if (manifest.rowCounts.project_approval_events > 0) {
  let refused = false
  try {
    psql(`begin;
      update public.project_approval_events set project_id = project_id
      where id = (select id from public.project_approval_events limit 1);
      rollback;`)
  } catch (err) {
    refused = /not permitted|immutable/i.test(String(err.stderr ?? err.message))
  }
  check("approval history is append-only again after the restore (UPDATE refused)", refused)
} else {
  console.log("  (no approval history in this backup to probe the guard with)")
}

console.log(`\n${passes} passed, ${failures} failed.`)
process.exit(failures ? 1 : 0)
