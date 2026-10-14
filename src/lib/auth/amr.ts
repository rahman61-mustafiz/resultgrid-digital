/**
 * Reading Supabase's `amr` (Authentication Methods Reference) claims: a
 * signed record, inside the access token, of which methods the session
 * used and when (Unix seconds). Pure functions, so they can be unit-tested.
 */

export type AmrEntry = { method: string; timestamp: number }

/** Methods Supabase records when a session comes from an emailed recovery link. */
export const RESET_LINK_METHODS = ["recovery", "otp"] as const

export function latestTimestampFor(amr: AmrEntry[], methods: readonly string[]): number | null {
  const timestamps = amr.filter((e) => methods.includes(e.method)).map((e) => e.timestamp)
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

/**
 * True when this session opened a password-reset link AND completed the TOTP
 * challenge, both within `windowSeconds` -- so whoever sets the new password
 * controls both the email inbox and the authenticator. A normal password +
 * TOTP session never qualifies, whatever cookies it carries.
 */
export function isRecentPasswordReset(amr: AmrEntry[], nowSeconds: number, windowSeconds: number): boolean {
  const linkAt = latestTimestampFor(amr, RESET_LINK_METHODS)
  const totpAt = latestTimestampFor(amr, ["totp"])
  if (linkAt === null || totpAt === null) return false
  const fresh = (t: number) => nowSeconds - t <= windowSeconds && t <= nowSeconds + 60
  return fresh(linkAt) && fresh(totpAt) && totpAt >= linkAt
}
