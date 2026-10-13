"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  generateSessionNonce,
  hashPin,
  hashSessionNonce,
  SHARE_PIN_LOCKOUT_SECONDS,
  SHARE_PIN_MAX_ATTEMPTS,
  SHARE_SESSION_MAX_AGE_SECONDS,
} from "@/lib/domain/share-link"

export type VerifyPinState = { error: string } | null

export async function verifySharePinAction(
  token: string,
  _prevState: VerifyPinState,
  formData: FormData
): Promise<VerifyPinState> {
  const pin = (formData.get("pin") as string | null)?.trim() ?? ""
  if (!pin) {
    return { error: "Enter the PIN." }
  }

  const admin = createAdminClient()
  const { data: link } = await admin
    .from("client_share_links")
    .select(
      "pin_hash, expires_at, revoked_at, failed_pin_attempts, locked_until"
    )
    .eq("token", token)
    .maybeSingle()

  if (!link || link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) {
    return { error: "This link is no longer available." }
  }

  if (link.locked_until && new Date(link.locked_until).getTime() > Date.now()) {
    return {
      error: "Too many incorrect attempts. Try again in a few minutes.",
    }
  }

  if (hashPin(pin, token) !== link.pin_hash) {
    const attempts = link.failed_pin_attempts + 1
    const lockedOut = attempts >= SHARE_PIN_MAX_ATTEMPTS
    await admin
      .from("client_share_links")
      .update({
        failed_pin_attempts: lockedOut ? 0 : attempts,
        locked_until: lockedOut
          ? new Date(Date.now() + SHARE_PIN_LOCKOUT_SECONDS * 1000).toISOString()
          : null,
      })
      .eq("token", token)

    return lockedOut
      ? { error: "Too many incorrect attempts. Try again in a few minutes." }
      : { error: "Incorrect PIN." }
  }

  // Correct PIN: issue a fresh session nonce. Only its hash is stored, and
  // only the raw nonce (in the httpOnly cookie) proves this browser passed
  // the PIN check -- see src/lib/domain/share-link.ts for why this replaced
  // a plain "1" flag.
  const nonce = generateSessionNonce()
  const sessionExpiresAt = new Date(
    Date.now() + SHARE_SESSION_MAX_AGE_SECONDS * 1000
  ).toISOString()

  await admin
    .from("client_share_links")
    .update({
      session_nonce_hash: hashSessionNonce(nonce),
      session_nonce_expires_at: sessionExpiresAt,
      failed_pin_attempts: 0,
      locked_until: null,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("token", token)

  const cookieStore = await cookies()
  cookieStore.set(`rg_share_${token}`, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/share/${token}`,
    maxAge: SHARE_SESSION_MAX_AGE_SECONDS,
  })

  revalidatePath(`/share/${token}`)
  return null
}
