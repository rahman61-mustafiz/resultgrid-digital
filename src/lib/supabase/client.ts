import { createBrowserClient } from "@supabase/ssr"

import { clientEnv } from "@/lib/env/client"
import type { Database } from "@/lib/supabase/types"

/**
 * Supabase client for use inside client components. Subject to Row Level
 * Security via the anon key -- never use this for privileged server logic.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
