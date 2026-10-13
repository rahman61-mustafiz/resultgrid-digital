/**
 * Phone vs. desktop, from request headers (spec A07/I08: mobile is
 * view-only in the first release; editing is desktop-only).
 *
 * Chromium browsers (Android Chrome, the spec's mobile target) send the
 * `Sec-CH-UA-Mobile` client hint on every request, including Server
 * Action POSTs; it is authoritative when present. Other browsers (iOS
 * Safari, Firefox) don't, so the User-Agent decides. Tablets that present
 * a desktop User-Agent (iPadOS by default, most Android tablets) count as
 * desktop, as does a phone using "Request desktop site".
 *
 * This is a product rule, not a security boundary: anyone can change these
 * headers. Authorization is unchanged and lives in Postgres.
 */
type HeaderSource = { get(name: string): string | null }

const MOBILE_USER_AGENT = /\b(Mobi|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini)\b|Android.*\bMobile\b/i

export function isMobileDevice(headers: HeaderSource): boolean {
  const hint = headers.get("sec-ch-ua-mobile")
  if (hint === "?1") return true
  if (hint === "?0") return false
  return MOBILE_USER_AGENT.test(headers.get("user-agent") ?? "")
}

export const MOBILE_VIEW_ONLY_MESSAGE =
  "Editing is desktop-only in this release. On a phone you can sign in and view your dashboard, projects and reports."

/**
 * Paths whose writes a phone may make: signing in, TOTP enrollment and
 * verification, unlocking, account recovery, signing out, and the client
 * share-link PIN form. Everything else is read-only on a phone.
 */
const MOBILE_WRITABLE_PATHS = ["/login", "/setup/totp", "/lock", "/recovery", "/share", "/auth/sign-out"]

export function isMobileWritablePath(pathname: string): boolean {
  return MOBILE_WRITABLE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS"
}
