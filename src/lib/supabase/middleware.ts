import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { clientEnv } from "@/lib/env/client"

/**
 * Refreshes the Supabase session cookie on every request. This must run in
 * middleware (not just in Server Components) because Server Components
 * can't write cookies -- without this, sessions would silently expire.
 *
 * Route protection and the idle-lock/AAL2 checks live in
 * src/middleware.ts, which calls this first.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  // Required: this call refreshes the session and must not be removed or
  // reordered relative to the cookie handlers above.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, supabase, user }
}
