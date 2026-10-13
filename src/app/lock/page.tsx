import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { SignOutButton } from "@/components/sign-out-button"
import { UnlockForm } from "@/app/lock/unlock-form"

export default async function LockPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.listFactors()

  const factor = data?.totp.find((f) => f.status === "verified")

  if (error || !factor) {
    redirect("/login")
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-muted/30 p-6">
      <UnlockForm factorId={factor.id} />
      <SignOutButton variant="ghost" label="Sign out instead" />
    </div>
  )
}
