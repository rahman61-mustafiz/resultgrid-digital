"use server"

import { headers } from "next/headers"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { serverEnv } from "@/lib/env/server"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { checkLoginCooldown } from "@/lib/auth/rate-limit"

const recoverySchema = z.object({
  password: z.string().min(1, "Enter your password."),
})

export type RecoveryState = { error: string; success?: boolean } | null

/**
 * Break-glass factor-replacement flow (BUILD_READINESS_QUESTIONNAIRE.md
 * C13): requires the correct account password, then sends a short-lived,
 * single-use link to the pre-verified recovery email. This is NOT a
 * "forgot password" flow -- the password is known and verified here; the
 * email link only proves control of the recovery inbox, and
 * /recovery/callback forces a brand-new TOTP enrollment before any
 * workspace data becomes reachable again (see that page and
 * src/proxy.ts's AAL gate).
 *
 * Reuses Supabase's own password-reset email delivery (the "Supabase
 * built-in SMTP" option) rather than building a custom email sender --
 * the recovery session it grants is used only to authorize a factor
 * swap, never to actually change the password.
 */
export async function requestRecoveryAction(
  _prevState: RecoveryState,
  formData: FormData
): Promise<RecoveryState> {
  const parsed = recoverySchema.safeParse({ password: formData.get("password") })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const headerList = await headers()
  const userAgent = headerList.get("user-agent")
  const ipAddress = headerList.get("x-forwarded-for")

  const { blocked } = await checkLoginCooldown(serverEnv.OWNER_EMAIL)
  if (blocked) {
    await logSecurityEvent({
      eventType: "ACCOUNT_LOCKED_COOLDOWN",
      userId: null,
      metadata: { emailAttempted: serverEnv.OWNER_EMAIL, context: "recovery" },
      ipAddress,
      userAgent,
    })
    return { error: "Too many failed attempts. Try again in 15 minutes." }
  }

  // Verify the password without keeping the resulting session -- this
  // flow must not itself grant access; it only authorizes sending the
  // recovery email.
  const supabase = await createClient()
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: serverEnv.OWNER_EMAIL,
    password: parsed.data.password,
  })

  if (signInError || !signInData.user) {
    await logSecurityEvent({
      eventType: "FAILED_PASSWORD_ATTEMPT",
      userId: null,
      metadata: { emailAttempted: serverEnv.OWNER_EMAIL, context: "recovery" },
      ipAddress,
      userAgent,
    })
    return { error: "Incorrect password." }
  }

  const userId = signInData.user.id
  await supabase.auth.signOut()

  // resetPasswordForEmail actually dispatches the email via the project's
  // configured mailer (Supabase's built-in SMTP for this MVP); the admin
  // API's generateLink() only returns a link without sending anything,
  // which would need a separate email-sending integration we don't have.
  const { error: linkError } = await supabase.auth.resetPasswordForEmail(
    serverEnv.RECOVERY_EMAIL,
    { redirectTo: `${serverEnv.APP_URL}/recovery/callback` }
  )

  if (linkError) {
    return { error: "Could not send the recovery email. Try again shortly." }
  }

  await logSecurityEvent({
    eventType: "RECOVERY_REQUESTED",
    userId,
    metadata: { recoveryEmail: serverEnv.RECOVERY_EMAIL },
    ipAddress,
    userAgent,
  })

  return { error: "", success: true }
}
