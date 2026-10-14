"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { recognizeDevice } from "@/lib/auth/devices"
import { checkLoginCooldown } from "@/lib/auth/rate-limit"
import { getUserWorkspaceId } from "@/lib/auth/workspace"
import { PASSWORD_RESET_WINDOW_SECONDS, SESSION_COOKIE, secondsSince, sessionCookieOptions } from "@/lib/auth/session-policy"

const verifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
})

export type VerifyTotpState = { error: string } | null

export async function verifyLoginTotpAction(
  _prevState: VerifyTotpState,
  formData: FormData
): Promise<VerifyTotpState> {
  const parsed = verifySchema.safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
  })

  if (!parsed.success) {
    return { error: "Enter the 6-digit code from your authenticator app." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const headerList = await headers()
  const userAgent = headerList.get("user-agent")
  const ipAddress = headerList.get("x-forwarded-for")
  const workspaceId = user ? await getUserWorkspaceId(user.id) : null

  if (user?.email) {
    const { blocked } = await checkLoginCooldown(user.email)
    if (blocked) {
      await logSecurityEvent({
        eventType: "ACCOUNT_LOCKED_COOLDOWN",
        userId: user.id,
        workspaceId,
        metadata: { emailAttempted: user.email, context: "totp_challenge" },
        ipAddress,
        userAgent,
      })
      return {
        error: "Too many failed attempts. Try again in 15 minutes.",
      }
    }
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  })

  if (error) {
    await logSecurityEvent({
      eventType: "FAILED_TOTP_ATTEMPT",
      userId: user?.id ?? null,
      workspaceId,
      metadata: user?.email ? { emailAttempted: user.email } : {},
      ipAddress,
      userAgent,
    })
    return { error: "Incorrect or expired code. Try again." }
  }

  if (user) {
    const { isNewDevice } = await recognizeDevice(user.id, userAgent)
    await logSecurityEvent({
      eventType: isNewDevice ? "NEW_DEVICE_LOGIN" : "RECENT_REAUTH_COMPLETED",
      userId: user.id,
      workspaceId,
      metadata: { emailAttempted: user.email ?? "" },
      ipAddress,
      userAgent,
    })
  }

  // Starts the 30-minute idle-lock clock -- see src/proxy.ts, which
  // requires this cookie to already exist by the time it evaluates
  // AAL2-gated routes (a missing cookie there means "lock", not "fresh").
  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE.lastActivityAt,
    new Date().toISOString(),
    sessionCookieOptions()
  )

  // Forgot password: the link was opened (src/app/auth/confirm/route.ts);
  // with the TOTP code done, go and set the new password.
  const resetStartedAt = cookieStore.get(SESSION_COOKIE.passwordReset)?.value
  if (resetStartedAt && secondsSince(resetStartedAt) <= PASSWORD_RESET_WINDOW_SECONDS) {
    redirect("/reset-password")
  }

  redirect("/dashboard")
}
