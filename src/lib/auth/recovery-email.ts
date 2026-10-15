import "server-only"

import { createClient } from "@supabase/supabase-js"

import { serverEnv } from "@/lib/env/server"

/**
 * Sends the recovery email (supabase/templates/recovery.html) for both
 * "Forgot password?" and "Lost your authenticator app?".
 *
 * Deliberately NOT the SSR client: that one uses the PKCE flow, whose
 * emailed token (`pkce_...`) is meant to be exchanged for a session in the
 * browser that asked for it, and verifying it on the server at
 * /auth/confirm gives no session -- the reader landed back on /login. A
 * stateless implicit-flow client makes Supabase email a plain token hash,
 * which /auth/confirm verifies on the server in any browser.
 */
export async function sendRecoveryEmail(email: string, redirectPath: "/reset-password" | "/recovery/callback") {
  const client = createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client.auth.resetPasswordForEmail(email, { redirectTo: `${serverEnv.APP_URL}${redirectPath}` })
}
