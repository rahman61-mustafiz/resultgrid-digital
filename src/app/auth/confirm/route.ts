import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, PASSWORD_RESET_WINDOW_SECONDS, sessionCookieOptions } from "@/lib/auth/session-policy"

/** Where an emailed link may continue to. Anything else is refused. */
const NEXT_PATHS = ["/reset-password", "/recovery/callback"] as const

/**
 * Target of the "Reset password" email (supabase/templates/recovery.html):
 * `?token_hash=...&type=recovery&next=<redirectTo>`. The token is verified
 * here, on the server, so the link works in any browser or device -- unlike
 * the PKCE code flow, which needs the browser that asked for it.
 *
 * The session this creates is aal1 only. Both flows that use the link then
 * require more before anything changes:
 * - /reset-password (forgot password): the TOTP challenge at /login/verify,
 *   then the new password (src/app/reset-password/actions.ts).
 * - /recovery/callback (lost authenticator): asked for with the password
 *   already checked; replaces the TOTP factor.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")
  const next = nextPath(searchParams.get("next"))

  const fail = (reason: string) => {
    const url = request.nextUrl.clone()
    url.pathname = next === "/recovery/callback" ? "/recovery" : "/forgot-password"
    url.search = `?link=${reason}`
    return NextResponse.redirect(url)
  }

  if (!tokenHash || type !== "recovery" || !next) return fail("invalid")

  const supabase = await createClient()
  // Any session already in this browser is replaced by the link's.
  await supabase.auth.signOut({ scope: "local" })
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })
  if (error) return fail("expired")

  const url = request.nextUrl.clone()
  url.search = ""
  // Forgot password: the proxy would send this aal1 session to /login/verify
  // anyway; after the TOTP code, verify sends it on to /reset-password
  // because of the passwordReset cookie.
  url.pathname = next === "/reset-password" ? "/login/verify" : next
  const response = NextResponse.redirect(url)
  if (next === "/reset-password") {
    response.cookies.set(SESSION_COOKIE.passwordReset, new Date().toISOString(), sessionCookieOptions(PASSWORD_RESET_WINDOW_SECONDS))
    response.cookies.set(SESSION_COOKIE.sessionStartedAt, new Date().toISOString(), sessionCookieOptions(SESSION_MAX_AGE_SECONDS))
    response.cookies.delete(SESSION_COOKIE.locked)
    response.cookies.delete(SESSION_COOKIE.lastActivityAt)
  }
  return response
}

/** `next` is the redirectTo URL Supabase puts in the email; only its path is used. */
function nextPath(value: string | null): (typeof NEXT_PATHS)[number] | null {
  if (!value) return null
  try {
    const path = new URL(value, "http://placeholder").pathname
    return (NEXT_PATHS as readonly string[]).includes(path) ? (path as (typeof NEXT_PATHS)[number]) : null
  } catch {
    return null
  }
}
