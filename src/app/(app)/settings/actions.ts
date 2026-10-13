"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireRecentReauth, RecentReauthRequiredError } from "@/lib/auth/reauth"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { getUserWorkspaceId } from "@/lib/auth/workspace"

const REAUTH_MESSAGE =
  "This requires a fresh password + TOTP sign-in within the last 5 minutes. Sign out and back in, then try again."

const changePasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  })

export type SettingsActionState = { error: string; success?: boolean } | null

export async function changePasswordAction(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  await assertEditingAllowed()
  try {
    await requireRecentReauth()
  } catch (e) {
    if (e instanceof RecentReauthRequiredError) {
      return { error: REAUTH_MESSAGE }
    }
    throw e
  }

  const parsed = changePasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  })

  if (error) {
    return { error: "Could not change the password." }
  }

  const headerList = await headers()
  const workspaceId = user ? await getUserWorkspaceId(user.id) : null
  await logSecurityEvent({
    eventType: "PASSWORD_CHANGE",
    userId: user?.id ?? null,
    workspaceId,
    ipAddress: headerList.get("x-forwarded-for"),
    userAgent: headerList.get("user-agent"),
  })

  return { error: "", success: true }
}

/**
 * Returns an error result rather than throwing, so the client caller can
 * safely `await` this without a try/catch that would also intercept
 * next/navigation's redirect() -- which works by throwing internally, and
 * must propagate untouched for the navigation to actually happen.
 */
export async function resetTotpAction(): Promise<{ error: string } | null> {
  await assertEditingAllowed()
  try {
    await requireRecentReauth()
  } catch (e) {
    if (e instanceof RecentReauthRequiredError) {
      return { error: REAUTH_MESSAGE }
    }
    throw e
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  for (const factor of factorsData?.all ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id })
  }

  const headerList = await headers()
  const workspaceId = user ? await getUserWorkspaceId(user.id) : null
  await logSecurityEvent({
    eventType: "TOTP_CHANGED",
    userId: user?.id ?? null,
    workspaceId,
    ipAddress: headerList.get("x-forwarded-for"),
    userAgent: headerList.get("user-agent"),
  })

  redirect("/setup/totp")
}
