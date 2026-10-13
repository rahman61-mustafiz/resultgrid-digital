"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { getUserWorkspaceId } from "@/lib/auth/workspace"
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth/session-policy"

export type CompleteRecoveryResult = { error: string } | null

/**
 * Runs once the browser has established a session from the emailed
 * recovery link. Per BUILD_READINESS_QUESTIONNAIRE.md C13:
 * 1. Remove the lost TOTP factor(s) -- otherwise src/proxy.ts and
 *    /setup/totp would see a still-"verified" factor and route the
 *    Owner to /login/verify, a dead end since they don't have that
 *    device anymore.
 * 2. Revoke all sessions (this one included) via GoTrue's global-scope
 *    logout, so a lost/compromised device's old session can't linger.
 * 3. Redirect to /setup/totp -- mandatory new enrollment. RLS already
 *    requires AAL2 for workspace data, so nothing is reachable until
 *    that completes; no separate access gate is needed here.
 */
export async function completeRecoveryAction(): Promise<CompleteRecoveryResult> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return { error: "This recovery link is invalid or has expired." }
  }

  const userId = session.user.id
  const headerList = await headers()
  const userAgent = headerList.get("user-agent")
  const ipAddress = headerList.get("x-forwarded-for")

  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  for (const factor of factorsData?.all ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id })
  }

  const admin = createAdminClient()
  await admin.auth.admin.signOut(session.access_token, "global")

  const workspaceId = await getUserWorkspaceId(userId)
  await logSecurityEvent({
    eventType: "RECOVERY_COMPLETED",
    userId,
    workspaceId,
    ipAddress,
    userAgent,
  })

  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE.sessionStartedAt,
    new Date().toISOString(),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS)
  )
  cookieStore.delete(SESSION_COOKIE.locked)
  cookieStore.delete(SESSION_COOKIE.lastActivityAt)

  redirect("/setup/totp")
}
