/**
 * Session/security timing rules confirmed in
 * BUILD_READINESS_QUESTIONNAIRE.md section C (C15, C16) and
 * CLAUDE_CODE_BUILD_HANDOFF.md. Centralized here so middleware, the lock
 * screen, and sensitive server actions agree on the same numbers.
 */

/** Absolute session lifetime: an authenticated login session lasts no more than 8 hours. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

/** After 30 minutes without activity, the app locks and requires a TOTP challenge to unlock. */
export const IDLE_LOCK_SECONDS = 30 * 60

/**
 * Sensitive actions (password change, TOTP-factor change, recovery-email
 * change, permanent deletion, project approval) require password + TOTP
 * reauthentication within this preceding window.
 */
export const RECENT_REAUTH_WINDOW_SECONDS = 5 * 60

/** Five failed attempts trigger a cooldown. */
export const MAX_FAILED_ATTEMPTS = 5

/** Cooldown duration after MAX_FAILED_ATTEMPTS is reached. */
export const FAILED_ATTEMPT_COOLDOWN_SECONDS = 15 * 60

export const SESSION_COOKIE = {
  /** ISO timestamp set once, at successful password sign-in. Drives the 8h absolute cap. */
  sessionStartedAt: "rg_session_started_at",
  /** ISO timestamp refreshed on every authenticated, unlocked request. Drives the 30m idle lock. */
  lastActivityAt: "rg_last_activity_at",
  /** Presence means the app is idle-locked and must show the unlock (TOTP challenge) screen. */
  locked: "rg_locked",
  /**
   * ISO timestamp set when a password-reset link is opened. Only says where
   * to go after the TOTP challenge; the reset itself is authorized by the
   * session's signed amr claims (src/lib/auth/reauth.ts), never this cookie.
   */
  passwordReset: "rg_password_reset",
} as const

/** A password-reset link must be finished (TOTP + new password) within this window. */
export const PASSWORD_RESET_WINDOW_SECONDS = 15 * 60

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}

/**
 * `maxAgeSeconds` bounds how long the cookie can exist at all, not the
 * policy window itself -- the actual 30-minute idle threshold is enforced
 * by comparing the cookie's timestamp VALUE against now() in
 * src/proxy.ts, never by relying on the browser deleting the cookie.
 * These cookies therefore get a long-lived max-age (matching the 8h
 * session cap): a shorter one would let the browser silently drop the
 * cookie during genuine idle time, which src/proxy.ts would then
 * misread as "no cookie yet" (a fresh session) instead of "idle expired."
 */
export function sessionCookieOptions(maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS) {
  return { ...baseCookieOptions, maxAge: maxAgeSeconds }
}

export function secondsSince(isoTimestamp: string): number {
  const then = new Date(isoTimestamp).getTime()
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return (Date.now() - then) / 1000
}
