import "server-only"
import { cookies } from "next/headers"

import { createAdminClient } from "@/lib/supabase/admin"
import { sessionCookieOptions } from "@/lib/auth/session-policy"

const DEVICE_COOKIE = "rg_device_id"
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * Recognizes returning devices via a long-lived random id in an httpOnly
 * cookie (not fingerprinting). Call this once per completed (password +
 * TOTP) sign-in. Returns true when this is the first time this
 * user/device pair has been seen, which the caller should log as
 * NEW_DEVICE_LOGIN and notify the Owner about.
 */
export async function recognizeDevice(
  userId: string,
  userAgent: string | null
): Promise<{ isNewDevice: boolean }> {
  const cookieStore = await cookies()
  const existingCookie = cookieStore.get(DEVICE_COOKIE)?.value
  const deviceId = existingCookie ?? crypto.randomUUID()

  cookieStore.set(
    DEVICE_COOKIE,
    deviceId,
    sessionCookieOptions(DEVICE_COOKIE_MAX_AGE_SECONDS)
  )

  const admin = createAdminClient()
  const { data: existingDevice } = await admin
    .from("known_devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .maybeSingle()

  if (existingDevice) {
    await admin
      .from("known_devices")
      .update({ last_seen_at: new Date().toISOString(), user_agent: userAgent })
      .eq("id", existingDevice.id)
    return { isNewDevice: false }
  }

  await admin.from("known_devices").insert({
    user_id: userId,
    device_id: deviceId,
    user_agent: userAgent,
  })
  return { isNewDevice: true }
}
