#!/usr/bin/env node
/**
 * Downloadable backup of the linked Supabase project (BUILD_READINESS_QUESTIONNAIRE.md
 * J04: managed daily backups plus a weekly downloadable backup).
 *
 * Writes backups/<UTC timestamp>/:
 *   roles.sql   -- cluster roles          (supabase db dump --role-only)
 *   schema.sql  -- schema                 (supabase db dump)
 *   data.sql    -- all data, COPY format  (supabase db dump --data-only --use-copy)
 *   storage/<bucket>/<path> -- every Storage object
 *   manifest.json -- project ref, row count per public table, and size +
 *                    SHA-256 of every file, so a restore can be checked.
 *
 * The backup holds password hashes, MFA secrets and client data: keep it
 * off shared drives, encrypted at rest. backups/ is gitignored.
 * Needs Docker running (the CLI runs pg_dump in a container).
 *
 *   node --env-file=.env.local scripts/backup-database.mjs
 *
 * Restore procedure: DEPLOYMENT.md "Backups"; verified by
 * scripts/restore-check.mjs.
 */
import { createClient } from "@supabase/supabase-js"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const linkedRef = readFileSync("supabase/.temp/project-ref", "utf8").trim()
const urlRef = new URL(SUPABASE_URL).hostname.split(".")[0]
if (linkedRef !== urlRef) {
  console.error(`The linked project (${linkedRef}) is not the one in the env file (${urlRef}). Link the right project first.`)
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const dir = join("backups", stamp)
mkdirSync(join(dir, "storage"), { recursive: true })

function dump(file, extra) {
  console.log(`Dumping ${file}...`)
  execFileSync("npx", ["supabase", "db", "dump", "--linked", "-f", join(dir, file), ...extra], { stdio: ["ignore", "ignore", "pipe"], shell: true })
}
dump("roles.sql", ["--role-only"])
dump("schema.sql", [])
dump("data.sql", ["--data-only", "--use-copy"])

// Row counts of every public table, read the same way the app reads them.
const spec = await (await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` } })).json()
const rowCounts = {}
for (const table of Object.keys(spec.definitions ?? {}).sort()) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true })
  if (error) throw new Error(`count of ${table} failed: ${error.message}`)
  rowCounts[table] = count
}

async function listAll(bucket, prefix = "") {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`listing ${bucket}/${prefix} failed: ${error.message}`)
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) out.push(...(await listAll(bucket, path))) // a folder
      else out.push(path)
    }
    if (data.length < 1000) return out
  }
}

const { data: buckets, error: bucketError } = await admin.storage.listBuckets()
if (bucketError) throw new Error(`listing buckets failed: ${bucketError.message}`)
const storageObjects = {}
for (const bucket of buckets) {
  const paths = await listAll(bucket.id)
  storageObjects[bucket.id] = paths.length
  for (const path of paths) {
    const { data, error } = await admin.storage.from(bucket.id).download(path)
    if (error) throw new Error(`download of ${bucket.id}/${path} failed: ${error.message}`)
    const target = join(dir, "storage", bucket.id, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(await data.arrayBuffer()))
  }
  console.log(`Storage bucket ${bucket.id}: ${paths.length} object(s)`)
}

const files = {}
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) walk(p)
    else files[relative(dir, p).replaceAll("\\", "/")] = { bytes: statSync(p).size, sha256: createHash("sha256").update(readFileSync(p)).digest("hex") }
  }
}
walk(dir)

writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify({ projectRef: linkedRef, createdAt: new Date().toISOString(), rowCounts, storageObjects, files }, null, 2)
)
for (const f of ["roles.sql", "schema.sql", "data.sql"]) if (!files[f]?.bytes) throw new Error(`${f} is empty`)
console.log(`\nBackup written to ${dir} (${Object.keys(files).length} files; ${Object.values(rowCounts).reduce((a, b) => a + b, 0)} rows in ${Object.keys(rowCounts).length} public tables).`)
