import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { SignOutButton } from "@/components/sign-out-button"
import { VerifyTotpForm } from "@/app/login/verify/verify-form"

export default async function VerifyTotpPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.listFactors()

  const factor = data?.totp.find((f) => f.status === "verified")

  if (error || !factor) {
    // No verified factor to challenge -- either not signed in, or
    // enrollment hasn't happened yet. Middleware normally routes correctly
    // before this page renders; this is a defensive fallback.
    redirect("/login")
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <VerifyTotpForm factorId={factor.id} />
      <SignOutButton variant="ghost" label="Sign out instead" />
    </div>
  )
}
