"use server"

import { headers } from "next/headers"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { serverEnv } from "@/lib/env/server"
import { logSecurityEvent } from "@/lib/auth/security-log"

const schema = z.object({ email: z.email("Enter your email address.") })

export type ForgotPasswordState = { error: string; sent?: boolean } | null

/** At most this many reset emails per address in REQUEST_WINDOW_MINUTES. */
const MAX_REQUESTS = 3
const REQUEST_WINDOW_MINUTES = 15

/**
 * Forgot password, step 1: email a reset link. The answer is the same
 * whether or not the address has an account, so the form can't be used to
 * find out which emails exist. The link (supabase/templates/recovery.html)
 * opens /auth/confirm; the TOTP challenge and the new password come after.
 */
export async function requestPasswordResetAction(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const parsed = schema.safeParse({ email: String(formData.get("email") ?? "").trim().toLowerCase() })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter your email address." }
  const email = parsed.data.email

  const headerList = await headers()
  const ipAddress = headerList.get("x-forwarded-for")
  const userAgent = headerList.get("user-agent")

  const since = new Date(Date.now() - REQUEST_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error: countError } = await createAdminClient()
    .from("security_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "PASSWORD_RESET_REQUESTED")
    .filter("metadata->>emailAttempted", "eq", email)
    .gte("created_at", since)
  const limited = countError !== null || (count ?? 0) >= MAX_REQUESTS

  await logSecurityEvent({
    eventType: "PASSWORD_RESET_REQUESTED",
    userId: null,
    metadata: { emailAttempted: email, sent: !limited },
    ipAddress,
    userAgent,
  })

  if (!limited) {
    const supabase = await createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${serverEnv.APP_URL}/reset-password` })
    if (error) console.error("password reset email failed", error.message)
  }

  // Same answer in every case: sent, rate-limited, unknown address, or a
  // mail error (which is logged above).
  return { error: "", sent: true }
}
