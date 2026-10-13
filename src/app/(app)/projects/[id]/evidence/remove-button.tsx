"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { removeEvidenceItemAction } from "@/app/(app)/projects/[id]/evidence/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Removing evidence needs a reason. Evidence that is part of an export is
 * kept on record (and its file retained); anything else is deleted.
 */
export function RemoveEvidenceButton({
  itemId,
  projectId,
  inExport,
}: {
  itemId: string
  projectId: string
  inExport: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Remove
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 pt-2" data-testid="remove-evidence">
      <p className="text-xs text-muted-foreground">
        {inExport
          ? "This evidence is part of an export, so it stays on record (and its file is kept) but leaves the project's current evidence."
          : "This evidence isn't in any export, so it will be deleted, file included."}
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Reason for removing"
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending || reason.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              try {
                const result = await removeEvidenceItemAction(itemId, projectId, reason)
                if (result.error) {
                  setError(result.error)
                  return
                }
                setOpen(false)
                router.refresh()
              } catch {
                setError("Could not reach the server. Try again.")
              }
            })
          }
        >
          {inExport ? "Remove (keep on record)" : "Delete"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
