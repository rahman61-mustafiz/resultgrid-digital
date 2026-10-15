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
import { totpIssuer } from "@/lib/auth/totp-issuer"
import { serverEnv } from "@/lib/env/server"

const verifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
})

export type EnrollTotpState = { error: string } | null

export type StartEnrollmentResult =
  | { ok: true; factorId: string; qrCodeDataUrl: string; secret: string }
  | { ok: false; error: string }

/**
 * Starts (or resumes) TOTP enrollment. Called once, client-side, when the
 * enrollment UI mounts -- NOT from the page's Server Component render.
 *
 * This matters: a Server Component that unenrolled stale factors and
 * called mfa.enroll() on every render would silently invalidate the
 * secret the user is looking at whenever that route re-renders for an
 * unrelated reason (e.g. Next re-fetching the route after a failed verify
 * action updates client state). Doing it once from the client and caching
 * the result in React state avoids that.
 */
export async function startTotpEnrollmentAction(): Promise<StartEnrollmentResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: "Not signed in." }
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors()

  const verified = factorsData?.totp.find((f) => f.status === "verified")
  if (verified) {
    // Already enrolled (e.g. completed in another tab) -- nothing to do
    // here; the caller should route to /login/verify instead.
    return { ok: false, error: "ALREADY_ENROLLED" }
  }

  for (const factor of factorsData?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id })
    }
  }

  const { data: enrollData, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: totpIssuer(serverEnv.APP_URL),
  })

  if (error || !enrollData || enrollData.type !== "totp") {
    return { ok: false, error: "Could not start authenticator-app enrollment." }
  }

  return {
    ok: true,
    factorId: enrollData.id,
    qrCodeDataUrl: enrollData.totp.qr_code,
    secret: enrollData.totp.secret,
  }
}

export async function verifyTotpEnrollmentAction(
  _prevState: EnrollTotpState,
  formData: FormData
): Promise<EnrollTotpState> {
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
        metadata: { emailAttempted: user.email, context: "enrollment" },
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
      metadata: { context: "enrollment", emailAttempted: user?.email ?? "" },
      ipAddress,
      userAgent,
    })
    return { error: "Incorrect or expired code. Try again." }
  }

  if (user) {
    await recognizeDevice(user.id, userAgent)
    await logSecurityEvent({
      eventType: "TOTP_ENROLLED",
      userId: user.id,
      workspaceId,
      ipAddress,
      userAgent,
    })
  }

  // Starts the 30-minute idle-lock clock -- see src/proxy.ts.
  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE.lastActivityAt,
    new Date().toISOString(),
    sessionCookieOptions()
  )

  // Forgot password with no authenticator enrolled (e.g. it was removed):
  // the emailed link, then this fresh enrollment, then the new password.
  const resetStartedAt = cookieStore.get(SESSION_COOKIE.passwordReset)?.value
  if (resetStartedAt && secondsSince(resetStartedAt) <= PASSWORD_RESET_WINDOW_SECONDS) {
    redirect("/reset-password")
  }

  redirect("/dashboard")
}
