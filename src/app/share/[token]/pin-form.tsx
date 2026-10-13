"use client"

import { useActionState } from "react"

import { verifySharePinAction, type VerifyPinState } from "@/app/share/[token]/actions"
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

const initialState: VerifyPinState = null

export function PinForm({ token }: { token: string }) {
  const action = verifySharePinAction.bind(null, token)
  const [state, formAction, isPending] = useActionState(action, initialState)

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Enter PIN</CardTitle>
          <CardDescription>
            Enter the PIN you were given to view this report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin">PIN</Label>
              <Input id="pin" name="pin" inputMode="numeric" required autoFocus />
            </div>
            {state?.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Checking..." : "View report"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
