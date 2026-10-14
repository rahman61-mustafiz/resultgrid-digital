import Link from "next/link"

import { ResetPasswordForm } from "@/app/reset-password/reset-password-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PasswordResetNotVerifiedError, requireRecentPasswordReset } from "@/lib/auth/reauth"

export default async function ResetPasswordPage() {
  let verified = true
  try {
    await requireRecentPasswordReset()
  } catch (e) {
    if (!(e instanceof PasswordResetNotVerifiedError)) throw e
    verified = false
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          {verified ? <CardDescription>Your other signed-in sessions will be signed out.</CardDescription> : null}
        </CardHeader>
        <CardContent>
          {verified ? (
            <ResetPasswordForm />
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="reset-not-verified">
              This page works only right after opening a reset link from your email and entering your authenticator code, within 15
              minutes.{" "}
              <Link href="/forgot-password" className="underline">
                Request a new link
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
