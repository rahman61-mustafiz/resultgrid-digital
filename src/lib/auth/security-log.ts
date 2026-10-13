import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import type { Json } from "@/lib/supabase/types"
import type { SecurityEventType } from "@/lib/domain/enums"

export type { SecurityEventType }

/**
 * Records a security-audit event. `metadata` must never contain passwords,
 * TOTP secrets/codes, session tokens, or other sensitive business data --
 * see CLAUDE_CODE_BUILD_HANDOFF.md. Rows are append-only (see the
 * security_events migration); there is no update/delete path.
 */
export async function logSecurityEvent(input: {
  eventType: SecurityEventType
  userId: string | null
  workspaceId?: string | null
  metadata?: Record<string, Json>
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const admin = createAdminClient()
  const { error } = await admin.from("security_events").insert({
    event_type: input.eventType,
    user_id: input.userId,
    workspace_id: input.workspaceId ?? null,
    metadata: input.metadata ?? {},
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
  })

  if (error) {
    // A failed audit write must never block the user-facing auth flow, but
    // it must not be silent either.
    console.error("Failed to write security event", input.eventType, error)
  }
}
