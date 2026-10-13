"use client"

import { useActionState } from "react"

import { unlockAction, type UnlockState } from "@/app/lock/actions"
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

const initialState: UnlockState = null

export function UnlockForm({ factorId }: { factorId: string }) {
  const [state, formAction, isPending] = useActionState(
    unlockAction,
    initialState
  )

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Session locked</CardTitle>
        <CardDescription>
          You&apos;ve been away for a while. Enter your authenticator code to
          continue.
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
            {isPending ? "Verifying..." : "Unlock"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
