"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { checkLoginCooldown } from "@/lib/auth/rate-limit"
import { getUserWorkspaceId } from "@/lib/auth/workspace"
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session-policy"

const unlockSchema = z.object({
  factorId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
})

export type UnlockState = { error: string } | null

export async function unlockAction(
  _prevState: UnlockState,
  formData: FormData
): Promise<UnlockState> {
  const parsed = unlockSchema.safeParse({
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
        metadata: { emailAttempted: user.email, context: "unlock" },
        ipAddress,
        userAgent,
      })
      return {
        error: "Too many failed attempts. Try again in 15 minutes.",
      }
    }
  }

  // The session is already at AAL2 -- this challenge re-proves physical
  // possession of the authenticator app to unlock the UI, per
  // BUILD_READINESS_QUESTIONNAIRE.md C15 ("requires a valid TOTP challenge
  // to unlock"). It intentionally does not require the password again, and
  // intentionally does NOT count as the password+TOTP reauthentication
  // that sensitive actions require -- see src/lib/auth/reauth.ts, which
  // derives that from the session's signed amr claims and will correctly
  // still see a stale 'password' timestamp after an unlock like this.
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  })

  if (error) {
    await logSecurityEvent({
      eventType: "FAILED_TOTP_ATTEMPT",
      userId: user?.id ?? null,
      workspaceId,
      metadata: { context: "unlock", emailAttempted: user?.email ?? "" },
      ipAddress,
      userAgent,
    })
    return { error: "Incorrect or expired code. Try again." }
  }

  await logSecurityEvent({
    eventType: "SESSION_UNLOCKED",
    userId: user?.id ?? null,
    workspaceId,
    ipAddress,
    userAgent,
  })

  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE.locked)
  cookieStore.set(
    SESSION_COOKIE.lastActivityAt,
    new Date().toISOString(),
    sessionCookieOptions()
  )

  redirect("/dashboard")
}
