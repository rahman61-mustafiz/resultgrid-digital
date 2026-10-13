import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { SignOutButton } from "@/components/sign-out-button"
import { EnrollTotpFlow } from "@/app/setup/totp/enroll-flow"

export default async function SetupTotpPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors()

  // A verified factor already exists: enrollment isn't needed (or was
  // already completed in another tab). Send the user to the normal
  // challenge step instead.
  if (factorsData?.totp.some((f) => f.status === "verified")) {
    redirect("/login/verify")
  }

  // Enrollment itself (unenroll-stale, then mfa.enroll()) happens once,
  // client-side, in EnrollTotpFlow -- not here. See the comment on
  // startTotpEnrollmentAction for why this page must not do it on every
  // render.
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-muted/30 p-6">
      <EnrollTotpFlow />
      <SignOutButton variant="ghost" label="Sign out instead" />
    </div>
  )
}
