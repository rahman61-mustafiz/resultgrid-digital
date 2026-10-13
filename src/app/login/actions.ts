"use server"

import { headers, cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { logSecurityEvent } from "@/lib/auth/security-log"
import { checkLoginCooldown } from "@/lib/auth/rate-limit"
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth/session-policy"

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required."),
})

export type SignInState = { error: string } | null

export async function signInAction(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    return { error: "Enter a valid email and password." }
  }

  const { email, password } = parsed.data
  const headerList = await headers()
  const userAgent = headerList.get("user-agent")
  const ipAddress = headerList.get("x-forwarded-for")

  const { blocked } = await checkLoginCooldown(email)
  if (blocked) {
    await logSecurityEvent({
      eventType: "ACCOUNT_LOCKED_COOLDOWN",
      userId: null,
      metadata: { emailAttempted: email },
      ipAddress,
      userAgent,
    })
    return {
      error:
        "Too many failed attempts. Try again in 15 minutes, or use email recovery.",
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    await logSecurityEvent({
      eventType: "FAILED_PASSWORD_ATTEMPT",
      userId: null,
      metadata: { emailAttempted: email },
      ipAddress,
      userAgent,
    })
    return { error: "Incorrect email or password." }
  }

  // Start the 8-hour absolute session cap from the moment password
  // authentication succeeds, even though TOTP verification is still
  // required before any workspace data is reachable (see src/middleware.ts).
  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE.sessionStartedAt,
    new Date().toISOString(),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS)
  )

  // src/proxy.ts enforces the real destination on every request regardless
  // (direct navigation, refresh, bookmark), so this isn't a security
  // decision -- but redirecting straight to the right page avoids a
  // second, middleware-issued redirect hop after a Server Action
  // navigation, which Next's client router doesn't reliably reflect in the
  // address bar (content renders correctly either way, only the visible
  // URL lags).
  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const hasVerifiedTotp = factorsData?.totp.some((f) => f.status === "verified")
  redirect(hasVerifiedTotp ? "/login/verify" : "/setup/totp")
}
