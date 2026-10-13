import { NextResponse, type NextRequest } from "next/server"

import { isCronAuthorized } from "@/lib/auth/cron-auth"
import { processStorageCleanup } from "@/lib/evidence/storage-cleanup"

/** Batches per run; a larger backlog is finished by the next run. */
const MAX_BATCHES = 10
const BATCH = 50

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } })

/**
 * Scheduled run of the storage deletion queue (vercel.json crons), so an
 * expired upload's file doesn't wait for the next evidence change. Only a
 * request with `Authorization: Bearer $CRON_SECRET` runs it. A run with any
 * failed deletion answers 500 so the scheduler shows it; the failed items
 * stay queued with their error and are retried next time.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return json({ error: "unauthorized" }, 401)
  }

  let deleted = 0
  let failed = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const run = await processStorageCleanup(BATCH)
    deleted += run.deleted
    failed += run.failed
    if (run.failed > 0 || run.deleted < BATCH) break
  }
  return json({ deleted, failed }, failed > 0 ? 500 : 200)
}
