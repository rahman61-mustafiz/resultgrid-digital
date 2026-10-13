"use client"

import { useActionState } from "react"
import Link from "next/link"

import { requestRecoveryAction, type RecoveryState } from "@/app/recovery/actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: RecoveryState = null

export default function RecoveryPage() {
  const [state, formAction, isPending] = useActionState(
    requestRecoveryAction,
    initialState
  )

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Lost your authenticator app?</CardTitle>
          <CardDescription>
            Enter your password to receive a recovery link at the verified
            recovery email. It will require setting up a new authenticator
            app before you can access workspace data again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state?.success ? (
            <p className="text-sm">
              If the password was correct, a recovery link was sent. Check the
              recovery inbox.
            </p>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {state?.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.error}
                </p>
              ) : null}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? "Sending..." : "Send recovery link"}
              </Button>
              <Link
                href="/login"
                className="text-center text-sm text-muted-foreground underline"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
