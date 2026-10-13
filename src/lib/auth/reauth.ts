import "server-only"

import { createClient } from "@/lib/supabase/server"
import { RECENT_REAUTH_WINDOW_SECONDS } from "@/lib/auth/session-policy"

export class RecentReauthRequiredError extends Error {
  constructor() {
    super(
      "This action requires password + TOTP reauthentication within the last 5 minutes."
    )
    this.name = "RecentReauthRequiredError"
  }
}

type AmrEntry = { method: string; timestamp: number }

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
