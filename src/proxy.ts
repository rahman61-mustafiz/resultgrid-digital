import { NextResponse, type NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"
import { MOBILE_VIEW_ONLY_MESSAGE, isMobileDevice, isMobileWritablePath, isReadMethod } from "@/lib/device"
import {
  IDLE_LOCK_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  secondsSince,
  sessionCookieOptions,
} from "@/lib/auth/session-policy"

const PUBLIC_PATHS = ["/login", "/auth"]

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Mobile is view-only (spec A07/I08): a phone may read anything it is
  // authorized to, but any write -- a Server Action POST, a form post, a
  // route-handler mutation -- is refused here, before it reaches the app,
  // except signing in/out, TOTP, unlock, recovery and the share-link PIN.
  // Server Actions also check again (src/lib/auth/edit-policy.ts).
  if (!isReadMethod(request.method) && !isMobileWritablePath(pathname) && isMobileDevice(request.headers)) {
    return new NextResponse(MOBILE_VIEW_ONLY_MESSAGE, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    })
  }

  // /recovery must be reachable in EVERY auth state -- no session, or
  // stuck mid-login at aal1 with no usable TOTP device (the whole reason
  // this flow exists) -- so it's handled before any other routing, not
  // just added to PUBLIC_PATHS (which only applies in the !user branch
  // below).
  if (pathname === "/recovery" || pathname.startsWith("/recovery/")) {
    return (await updateSession(request)).response
  }

  // Sign-out must work in every auth state -- mid-enrollment, pending TOTP
  // verification, idle-locked -- so it skips the auth-state redirects below.
  // The route handler checks same-origin itself.
  if (pathname === "/auth/sign-out") {
    return (await updateSession(request)).response
  }

  // /share is a fully anonymous, PIN-gated viewer with no Supabase Auth
  // session involved at all (see src/app/share/[token]/page.tsx, which
  // uses the admin client directly) -- skip the session-refresh work
  // entirely rather than pointlessly calling it for every viewer.
  if (pathname === "/share" || pathname.startsWith("/share/")) {
    return NextResponse.next({ request })
  }

  // Scheduled jobs carry no user session; each route requires the
  // CRON_SECRET bearer token itself (src/lib/auth/cron-auth.ts).
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next({ request })
  }

  const { response, supabase, user } = await updateSession(request)

  if (!user) {
    if (isPublicPath(pathname)) return response
    return redirectTo(request, response, "/login")
  }

  // Public auth pages should redirect an already-signed-in user forward
  // rather than showing the login form again.
  if (pathname === "/login") {
    return redirectTo(request, response, "/dashboard")
  }

  const { data: rawAal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const aal = {
    currentLevel: rawAal?.currentLevel ?? "aal1",
    nextLevel: rawAal?.nextLevel ?? "aal1",
  }

  if (aal.currentLevel === "aal1" && aal.nextLevel === "aal1") {
    // Signed in, but no TOTP factor enrolled yet: mandatory enrollment
    // before any workspace data is reachable. No skip is allowed.
    if (pathname !== "/setup/totp") {
      return redirectTo(request, response, "/setup/totp")
    }
    return response
  }

  if (aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
    // A factor exists but this session hasn't completed the challenge yet.
    if (pathname !== "/login/verify") {
      return redirectTo(request, response, "/login/verify")
    }
    return response
  }

  // aal.currentLevel === "aal2": fully authenticated. Enforce the 8h
  // absolute session cap and the 30m idle lock.
  const startedAt = request.cookies.get(SESSION_COOKIE.sessionStartedAt)?.value
  if (!startedAt || secondsSince(startedAt) > SESSION_MAX_AGE_SECONDS) {
    await supabase.auth.signOut()
    return redirectTo(request, response, "/login", { expired: "1" })
  }

  const isLockRoute = pathname === "/lock"
  const alreadyLocked = request.cookies.get(SESSION_COOKIE.locked)?.value === "1"
  const lastActivityAt = request.cookies.get(SESSION_COOKIE.lastActivityAt)?.value
  // Every action that reaches AAL2 (login/verify, TOTP enrollment, unlock)
  // initializes this cookie itself before redirecting here -- see those
  // actions. So a MISSING cookie at this point is not "just logged in", it
  // means activity tracking was never established (or was lost), which
  // must fail closed to a lock, not open.
  const idleExpired = !lastActivityAt || secondsSince(lastActivityAt) > IDLE_LOCK_SECONDS

  if (alreadyLocked || idleExpired) {
    if (idleExpired && !alreadyLocked) {
      response.cookies.set(SESSION_COOKIE.locked, "1", sessionCookieOptions())
    }
    if (!isLockRoute) {
      return redirectTo(request, response, "/lock")
    }
    return response
  }

  if (isLockRoute) {
    // Session isn't locked; nothing to unlock.
    return redirectTo(request, response, "/dashboard")
  }

  response.cookies.set(
    SESSION_COOKIE.lastActivityAt,
    new Date().toISOString(),
    sessionCookieOptions()
  )

  return response
}

/**
 * Builds a redirect response that still carries whatever cookies were
 * already staged on `base` (the refreshed Supabase session cookies from
 * updateSession, and/or a `locked` cookie set just above) -- a bare
 * `NextResponse.redirect()` starts a brand-new response and silently
 * drops them, which would desync the client's session/lock state from
 * what the server just decided. See the Supabase SSR guidance on
 * middleware: refreshed cookies must be copied onto every response,
 * redirects included.
 */
function redirectTo(
  request: NextRequest,
  base: NextResponse,
  path: string,
  searchParams?: Record<string, string>
) {
  const url = request.nextUrl.clone()
  url.pathname = path
  url.search = ""
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value)
    }
  }
  const redirectResponse = NextResponse.redirect(url)
  for (const cookie of base.cookies.getAll()) {
    redirectResponse.cookies.set(cookie)
  }
  return redirectResponse
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and Next.js internals.
     * Keep this in sync with any new top-level static folders.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif)$).*)",
  ],
}
