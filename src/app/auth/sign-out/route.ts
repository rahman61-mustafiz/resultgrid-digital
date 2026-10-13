import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { SESSION_COOKIE } from "@/lib/auth/session-policy"

/**
 * Sign-out as a plain form POST to its own path (not a Server Action,
 * which posts to whatever page it was rendered on), so the mobile
 * view-only rule in src/proxy.ts can allow it by path.
 *
 * Server Actions get Next's built-in origin check; this handler checks
 * same-origin itself so another site can't sign the Owner out.
 *
 * src/proxy.ts lets this path through in every auth state (mid-enrollment,
 * pending TOTP verification, idle-locked), so the Owner can always leave.
 * The app's own session cookies are cleared too: a lingering lock cookie
 * would otherwise lock the next sign-in straight away.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  const crossOrigin =
    (origin !== null && (() => {
      try {
        return new URL(origin).host !== host
      } catch {
        return true
      }
    })()) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  if (crossOrigin) {
    return new NextResponse("Cross-origin sign-out refused.", { status: 403 })
  }

  const supabase = await createClient()
  await supabase.auth.signOut()
  // 303: the browser follows with a GET.
  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.search = ""
  const response = NextResponse.redirect(url, 303)
  for (const name of Object.values(SESSION_COOKIE)) response.cookies.delete(name)
  return response
}
