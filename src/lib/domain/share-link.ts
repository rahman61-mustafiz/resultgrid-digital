import { randomBytes, createHash } from "node:crypto"

export const DEFAULT_SHARE_LINK_EXPIRY_DAYS = 2

export const SHARE_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60
export const SHARE_PIN_MAX_ATTEMPTS = 5
export const SHARE_PIN_LOCKOUT_SECONDS = 15 * 60

export function generateShareToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * Issued only after a correct PIN check, and held ONLY as an httpOnly
 * cookie -- the DB stores just its hash (`hashSessionNonce`), so this is
 * the one piece of "proof of verification" that never touches the
 * database in recoverable form. Unlike a static "verified" flag, this
 * can't be forged by anyone who only has the (public, URL-visible) token.
 */
export function generateSessionNonce(): string {
  return randomBytes(32).toString("base64url")
}

export function hashSessionNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex")
}

export function generatePin(): string {
  // 6-digit numeric PIN, easy to read/type over WhatsApp.
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * The token itself (long, random, URL-only) is the primary secret; the
 * PIN is a defense-in-depth layer, per
 * BUILD_READINESS_QUESTIONNAIRE.md section I ("Both an expiry and PIN
 * protection are mandatory"). Hashing with the token as salt is enough
 * for that purpose -- this doesn't need to resist offline brute-forcing
 * the way a password hash does, since the token half of the pair isn't
 * guessable either.
 */
export function hashPin(pin: string, token: string): string {
  return createHash("sha256").update(`${pin}:${token}`).digest("hex")
}

/**
 * A plain helper (not called directly inside a Server Component's render
 * body) so eslint-plugin-react-hooks's purity rule doesn't flag the
 * inherently-current-time-dependent expiry check as an impure render.
 */
export function isLinkExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now()
}

export function isSessionNonceValid(
  presentedNonce: string | undefined,
  sessionNonceHash: string | null,
  sessionNonceExpiresAt: string | null
): boolean {
  return (
    !!presentedNonce &&
    !!sessionNonceHash &&
    !!sessionNonceExpiresAt &&
    new Date(sessionNonceExpiresAt).getTime() > Date.now() &&
    hashSessionNonce(presentedNonce) === sessionNonceHash
  )
}
