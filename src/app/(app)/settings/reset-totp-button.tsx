"use client"

import { useState, useTransition } from "react"

import { resetTotpAction } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"

export function ResetTotpButton() {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="destructive"
        disabled={isPending}
        onClick={() => {
          if (
            !window.confirm(
              "This removes your current authenticator and immediately requires you to set up a new one. Continue?"
            )
          ) {
            return
          }
          setError(null)
          startTransition(async () => {
            // Do NOT wrap this in try/catch: on success resetTotpAction
            // calls next/navigation's redirect(), which works by throwing
            // internally -- a catch here would intercept that throw and
            // break the navigation instead of just handling our own
            // error result.
            const result = await resetTotpAction()
            if (result?.error) {
              setError(result.error)
            }
          })
        }}
      >
        {isPending ? "Resetting..." : "Reset authenticator app"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
