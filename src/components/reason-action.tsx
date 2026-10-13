"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** A button that needs a reason first (archive/restore and similar). */
export function ReasonAction({
  action,
  label,
  note,
  testId,
}: {
  action: (reason: string) => Promise<{ error: string | null }>
  label: string
  note?: string
  testId?: string
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex gap-2">
        <Input aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button
          type="button"
          variant="outline"
          disabled={isPending || reason.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              try {
                const result = await action(reason)
                if (result.error) {
                  setError(result.error)
                  return
                }
                setReason("")
                router.refresh()
              } catch {
                setError("Could not reach the server. Try again.")
              }
            })
          }
        >
          {label}
        </Button>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
