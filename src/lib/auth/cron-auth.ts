import { createHash, timingSafeEqual } from "node:crypto"

/** Shortest CRON_SECRET accepted; a shorter one is treated as not configured. */
export const MIN_CRON_SECRET_LENGTH = 32

/**
 * Whether a scheduled-job request carries `Authorization: Bearer <secret>`
 * (the header Vercel Cron sends when CRON_SECRET is set). Compared in
 * constant time; a missing or too-short secret authorizes nothing.
 */
export function isCronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH || !authorization) return false
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))
}
