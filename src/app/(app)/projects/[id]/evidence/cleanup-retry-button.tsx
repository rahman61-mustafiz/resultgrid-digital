"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { retryStorageCleanupAction } from "@/app/(app)/projects/[id]/evidence/actions"
import { Button } from "@/components/ui/button"

export function CleanupRetryButton({ projectId }: { projectId?: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              try {
                const result = await retryStorageCleanupAction(projectId)
                if (result.error) setError(result.error)
                router.refresh()
              } catch {
                setError("Could not reach the server. Try again.")
              }
            })
          }
        >
          {isPending ? "Retrying..." : "Retry file deletion"}
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
