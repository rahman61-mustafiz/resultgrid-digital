import "server-only"
import { z } from "zod"

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_URL: z.url(),
  OWNER_EMAIL: z.email(),
  RECOVERY_EMAIL: z.email(),
})

/**
 * Server-only env vars, including secrets. Importing "server-only" makes
 * accidental use from a client component a build-time error rather than a
 * runtime leak.
 */
export const serverEnv = serverEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APP_URL: process.env.APP_URL,
  OWNER_EMAIL: process.env.OWNER_EMAIL,
  RECOVERY_EMAIL: process.env.RECOVERY_EMAIL,
})
