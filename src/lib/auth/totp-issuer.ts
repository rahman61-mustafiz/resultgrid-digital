/**
 * The name the authenticator app shows for this environment's entry. Dev,
 * staging and production each have their own account and TOTP secret; with
 * one shared name the entries were indistinguishable and the wrong code got
 * typed (14 October 2026).
 */
export function totpIssuer(appUrl: string): string {
  let host = ""
  try {
    host = new URL(appUrl).hostname
  } catch {
    return "ResultGrid"
  }
  if (host === "localhost" || host === "127.0.0.1") return "ResultGrid (dev)"
  if (host.includes("staging")) return "ResultGrid (staging)"
  if (host.startsWith("pukita.")) return "ResultGrid Pukita"
  return `ResultGrid (${host})`
}
