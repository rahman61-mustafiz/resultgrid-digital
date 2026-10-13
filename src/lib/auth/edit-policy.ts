import "server-only"

import { headers } from "next/headers"

import { MOBILE_VIEW_ONLY_MESSAGE, isMobileDevice } from "@/lib/device"

/**
 * Second layer of the mobile view-only rule (the first is src/proxy.ts,
 * which refuses phone writes before they reach any action). Every Server
 * Action that changes workspace data calls this first, so the rule holds
 * even if a request reaches an action without passing through the proxy.
 */
export async function assertEditingAllowed(): Promise<void> {
  if (isMobileDevice(await headers())) {
    throw new Error(MOBILE_VIEW_ONLY_MESSAGE)
  }
}

export async function isViewOnlyDevice(): Promise<boolean> {
  return isMobileDevice(await headers())
}
