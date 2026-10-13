import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { PasswordForm } from "@/app/(app)/settings/password-form"
import { ResetTotpButton } from "@/app/(app)/settings/reset-totp-button"
import { CleanupRetryButton } from "@/app/(app)/projects/[id]/evidence/cleanup-retry-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Evidence files still waiting to be deleted from Storage, any project
  // (including permanently deleted ones).
  const { data: pendingCleanup } = await supabase
    .from("storage_cleanup_queue")
    .select("id, last_error")
    .is("completed_at", null)
  const failedCleanup = (pendingCleanup ?? []).filter((c) => c.last_error)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Settings &amp; security</h1>
        <p className="text-sm text-muted-foreground">{user?.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Requires a password + TOTP sign-in within the last 5 minutes. If
            this fails, sign out and back in, then try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authenticator app</CardTitle>
          <CardDescription>
            Resetting removes your current authenticator and requires setting
            up a new one immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetTotpButton />
        </CardContent>
      </Card>

      <Card data-testid="file-cleanup-status">
        <CardHeader>
          <CardTitle>Evidence file deletion</CardTitle>
          <CardDescription>
            Files of deleted evidence are queued for deletion from storage and
            retried until they are gone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {pendingCleanup?.length ? (
            <>
              <p>
                {pendingCleanup.length} pending
                {failedCleanup.length ? `, ${failedCleanup.length} with a failed attempt (last error: ${failedCleanup[0].last_error})` : ""}.
              </p>
              <CleanupRetryButton />
            </>
          ) : (
            <p className="text-muted-foreground">Nothing pending.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security audit log</CardTitle>
          <CardDescription>
            Logins, password/TOTP changes, and failed attempts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/settings/audit">View audit log</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
