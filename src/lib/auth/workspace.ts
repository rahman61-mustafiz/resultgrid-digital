import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Looks up the workspace a user belongs to, for attaching workspace_id to
 * security_events rows. The MVP has exactly one workspace per user (in
 * practice exactly one workspace total), so the first membership row is
 * authoritative; this will need real disambiguation if multi-workspace
 * membership is ever introduced.
 */
export async function getUserWorkspaceId(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("Failed to look up workspace for user", userId, error)
    return null
  }

  return data?.workspace_id ?? null
}
