"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import {
  approveAndExportProjectAction,
  generateAdditionalExportAction,
  markReadyForReviewAction,
} from "@/app/(app)/projects/[id]/readiness/actions"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ReadinessActions({
  projectId,
  readinessStatus,
  isComplete,
  hasExport,
}: {
  projectId: string
  readinessStatus: string
  isComplete: boolean
  hasExport: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [approvalNote, setApprovalNote] = useState("")

  function run(action: () => Promise<{ error: string } | null>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result?.error) {
        setError(result.error)
      } else {
        setApprovalNote("")
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {readinessStatus === "INCOMPLETE" ? (
          <Button
            type="button"
            disabled={isPending || !isComplete}
            onClick={() => run(() => markReadyForReviewAction(projectId))}
          >
            Mark ready for review
          </Button>
        ) : null}

        {readinessStatus === "READY_FOR_REVIEW" ? (
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="approval-note" className="text-xs">
                Approval note (optional)
              </Label>
              <Textarea
                id="approval-note"
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                rows={2}
                placeholder="Recorded in the approval history alongside this approval."
              />
            </div>
            <Button
              type="button"
              disabled={isPending || !isComplete}
              onClick={() =>
                run(() => approveAndExportProjectAction(projectId, approvalNote))
              }
              className="self-start"
            >
              Approve &amp; generate export
            </Button>
          </div>
        ) : null}

        {readinessStatus === "APPROVED" ? (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => generateAdditionalExportAction(projectId))}
          >
            {hasExport ? "Generate a fresh export copy" : "Generate export"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
