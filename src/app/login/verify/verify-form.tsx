"use client"

import { useActionState } from "react"

import {
  verifyLoginTotpAction,
  type VerifyTotpState,
} from "@/app/login/verify/actions"
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

const initialState: VerifyTotpState = null

export function VerifyTotpForm({ factorId }: { factorId: string }) {
  const [state, formAction, isPending] = useActionState(
    verifyLoginTotpAction,
    initialState
  )

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Enter your authenticator code</CardTitle>
        <CardDescription>
          Open your authenticator app and enter the current 6-digit code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="factorId" value={factorId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Authenticator code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              autoFocus
            />
          </div>
          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Verifying..." : "Verify"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
