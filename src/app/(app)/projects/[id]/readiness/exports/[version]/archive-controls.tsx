"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { setExportArchivedAction } from "@/app/(app)/projects/[id]/readiness/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ExportArchiveControls({
  projectId,
  exportId,
  archived,
}: {
  projectId: string
  exportId: string
  archived: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-2" data-testid="export-archive-controls">
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
                const result = await setExportArchivedAction(projectId, exportId, !archived, reason)
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
          {archived ? "Restore export" : "Archive export"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Exports are never deleted. Archiving only moves this version out of the main list; it stays downloadable.
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
