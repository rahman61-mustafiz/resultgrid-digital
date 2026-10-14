import "server-only"

import { createClient } from "@/lib/supabase/server"
import { isRecentPasswordReset, type AmrEntry } from "@/lib/auth/amr"
import { PASSWORD_RESET_WINDOW_SECONDS, RECENT_REAUTH_WINDOW_SECONDS } from "@/lib/auth/session-policy"

export class RecentReauthRequiredError extends Error {
  constructor() {
    super(
      "This action requires password + TOTP reauthentication within the last 5 minutes."
    )
    this.name = "RecentReauthRequiredError"
  }
}

function decodeAccessTokenAmr(accessToken: string): AmrEntry[] {
  const payloadSegment = accessToken.split(".")[1]
  if (!payloadSegment) return []
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8")
    const payload = JSON.parse(json) as { amr?: AmrEntry[] }
    return payload.amr ?? []
  } catch {
    return []
  }
}

function latestTimestampFor(amr: AmrEntry[], method: string): number | null {
  const timestamps = amr.filter((e) => e.method === method).map((e) => e.timestamp)
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

/**
 * Password change, TOTP-factor change, recovery-email change, permanent
 * deletion, and project approval require password + TOTP
 * reauthentication within the preceding 5 minutes (see
 * BUILD_READINESS_QUESTIONNAIRE.md C15, G02). Call this at the top of
 * every server action that performs one of those operations.
 *
 * This is derived from Supabase's own `amr` (Authentication Methods
 * Reference) claims embedded in the access token -- a signed, server-
 * verified record of which methods were used and when -- rather than a
 * custom cookie. A custom cookie would be forgeable (nothing prevents a
 * client from sending an arbitrary Cookie header) and, worse, the idle-
 * lock's TOTP-only unlock (src/app/lock/actions.ts) must NOT by itself
 * satisfy this password+TOTP requirement; deriving from amr makes that
 * automatic, since an unlock only refreshes the 'totp' entry, not
 * 'password'.
 */
export async function requireRecentReauth() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new RecentReauthRequiredError()
  }

  const amr = decodeAccessTokenAmr(session.access_token)
  const passwordAt = latestTimestampFor(amr, "password")
  const totpAt = latestTimestampFor(amr, "totp")

  const nowSeconds = Date.now() / 1000
  const isFresh = (timestamp: number | null) =>
    timestamp !== null && nowSeconds - timestamp <= RECENT_REAUTH_WINDOW_SECONDS

  if (!isFresh(passwordAt) || !isFresh(totpAt)) {
    throw new RecentReauthRequiredError()
  }
}

export class PasswordResetNotVerifiedError extends Error {
  constructor() {
    super("Open the reset link from your email and enter your authenticator code first.")
    this.name = "PasswordResetNotVerifiedError"
  }
}

/**
 * The forgot-password flow's gate: the session must have come from an
 * emailed reset link and then passed the TOTP challenge, both within
 * PASSWORD_RESET_WINDOW_SECONDS. Uses getClaims(), which verifies the
 * access token's signature, so the amr claims can't be forged.
 */
export async function requireRecentPasswordReset() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const amr = (data?.claims?.amr ?? []) as AmrEntry[]
  if (error || !data?.claims || data.claims.aal !== "aal2") {
    throw new PasswordResetNotVerifiedError()
  }
  if (!isRecentPasswordReset(amr, Date.now() / 1000, PASSWORD_RESET_WINDOW_SECONDS)) {
    throw new PasswordResetNotVerifiedError()
  }
  return { userId: data.claims.sub as string }
}
