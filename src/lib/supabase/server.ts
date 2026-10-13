import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { serverEnv } from "@/lib/env/server"
import type { Database } from "@/lib/supabase/types"

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Runs with the caller's session (anon key + cookies), so Row Level Security
 * still applies -- this is not an admin client.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // A Server Component can't write cookies. When this client is only
          // used to read the session there, the call below throws and is
          // safe to ignore -- middleware is what actually refreshes cookies.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Ignored: see comment above.
          }
        },
      },
    }
  )
}
