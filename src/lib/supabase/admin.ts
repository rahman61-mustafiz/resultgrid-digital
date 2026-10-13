import "server-only"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { serverEnv } from "@/lib/env/server"
import type { Database } from "@/lib/supabase/types"

/**
 * Privileged Supabase client using the service-role key. This bypasses Row
 * Level Security entirely.
 *
 * Restrict usage to server-side admin operations that cannot run under the
 * caller's own session -- e.g. the email-recovery break-glass flow (revoking
 * sessions, replacing an MFA factor before the user has a valid session) and
 * writing security-audit events. Never import this from a client component
 * or expose its result directly to the client.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
