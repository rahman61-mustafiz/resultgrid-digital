"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { getUserWorkspaceId } from "@/lib/auth/workspace"
import { PasswordResetNotVerifiedError, requireRecentPasswordReset } from "@/lib/auth/reauth"
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session-policy"

const schema = z
  .object({
    newPassword: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "Passwords don't match.", path: ["confirmPassword"] })

export type ResetPasswordState = { error: string } | null

/**
 * Forgot password, last step: set the new password. Allowed only for a
 * session that opened the emailed link and then passed the TOTP challenge,
 * both within 15 minutes (requireRecentPasswordReset reads the signed amr
 * claims; the cookie only routes). Other sessions are signed out.
 */
export async function resetPasswordAction(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  let userId: string
  try {
    ;({ userId } = await requireRecentPasswordReset())
  } catch (e) {
    if (e instanceof PasswordResetNotVerifiedError) return { error: e.message }
    throw e
  }

  const parsed = schema.safeParse({ newPassword: formData.get("newPassword"), confirmPassword: formData.get("confirmPassword") })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword })
  if (error) {
    return { error: /different from the old|same_password/i.test(error.message) ? "Choose a password different from the old one." : "Could not set the new password. Try again." }
  }
  // Anyone signed in elsewhere with the old password is signed out.
  await supabase.auth.signOut({ scope: "others" })

  const headerList = await headers()
  await logSecurityEvent({
    eventType: "PASSWORD_RESET_COMPLETED",
    userId,
    workspaceId: await getUserWorkspaceId(userId),
    ipAddress: headerList.get("x-forwarded-for"),
    userAgent: headerList.get("user-agent"),
  })

  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE.passwordReset)
  cookieStore.set(SESSION_COOKIE.lastActivityAt, new Date().toISOString(), sessionCookieOptions())
  redirect("/dashboard?password=reset")
}
