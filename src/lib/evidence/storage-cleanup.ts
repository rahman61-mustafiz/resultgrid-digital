import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export type CleanupRun = { deleted: number; failed: number }

type Admin = ReturnType<typeof createAdminClient>

/**
 * Storage's delete reports success for an object that is already gone (and
 * even for an unknown bucket), so a delete that removed nothing is
 * confirmed by looking the object up. Returns an error message, or null.
 */
async function deleteObject(admin: Admin, bucket: string, path: string): Promise<string | null> {
  const { data: removed, error } = await admin.storage.from(bucket).remove([path])
  if (error) return error.message || "storage delete failed"
  if ((removed ?? []).length > 0) return null
  const slash = path.lastIndexOf("/")
  const name = path.slice(slash + 1)
  const { data: listed, error: listError } = await admin.storage.from(bucket).list(path.slice(0, slash), { search: name })
  if (listError) return `could not confirm the deletion: ${listError.message}`
  return (listed ?? []).some((o) => o.name === name) ? "the file is still stored after the delete" : null
}

/**
 * Works through storage_cleanup_queue: files whose evidence row or upload
 * is gone. The database queues them in the same transaction as the
 * deletion, so a failure here never loses one: it stays queued with its
 * error and is retried on the next run. claim_storage_cleanup skips any
 * path an evidence row or open upload still uses, and expires uploads left
 * open for 24 hours. Never throws; callers report a failed run.
 */
export async function processStorageCleanup(limit = 50): Promise<CleanupRun> {
  const admin = createAdminClient()
  const { data: items, error } = await admin.rpc("claim_storage_cleanup", { p_limit: limit })
  if (error || !items) {
    console.error(`storage cleanup: could not claim work: ${error?.message ?? "no data"}`)
    return { deleted: 0, failed: 1 }
  }

  let deleted = 0
  let failed = 0
  for (const item of items) {
    // An object that is already gone counts as deleted.
    const failure = await deleteObject(admin, item.bucket_id, item.storage_path)
    const { error: completeError } = await admin.rpc("complete_storage_cleanup", {
      p_id: item.id,
      p_error: failure ?? undefined,
    })
    if (failure || completeError) {
      failed += 1
      console.error(`storage cleanup: ${item.storage_path}: ${failure ?? `could not record completion: ${completeError?.message}`}`)
    } else {
      deleted += 1
    }
  }
  return { deleted, failed }
}
