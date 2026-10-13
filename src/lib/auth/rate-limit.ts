import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  FAILED_ATTEMPT_COOLDOWN_SECONDS,
  MAX_FAILED_ATTEMPTS,
} from "@/lib/auth/session-policy"

/**
 * Five failed password/TOTP attempts for the same email trigger a 15-minute
 * cooldown (BUILD_READINESS_QUESTIONNAIRE.md C16), on top of whatever
 * platform-level rate limiting Supabase applies independently.
 */
export async function checkLoginCooldown(
  email: string
): Promise<{ blocked: boolean }> {
  const admin = createAdminClient()
  const since = new Date(
    Date.now() - FAILED_ATTEMPT_COOLDOWN_SECONDS * 1000
  ).toISOString()

  const { data, error } = await admin
    .from("security_events")
    .select("id")
    .in("event_type", ["FAILED_PASSWORD_ATTEMPT", "FAILED_TOTP_ATTEMPT"])
    .filter("metadata->>emailAttempted", "eq", email)
    .gte("created_at", since)
    .limit(MAX_FAILED_ATTEMPTS)

  if (error) {
    console.error("Failed to check login cooldown", error)
    return { blocked: false }
  }

  return { blocked: (data?.length ?? 0) >= MAX_FAILED_ATTEMPTS }
}
