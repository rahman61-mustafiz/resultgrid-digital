"use client"

import { useState, useTransition } from "react"

import {
  deleteProjectPermanentlyAction,
  restoreProjectAction,
  setProjectLifecycleAction,
  type ProjectActionState,
} from "@/app/(app)/projects/actions"
import type { ProjectLifecycleStatus } from "@/lib/domain/enums"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const ACTION_LABELS: Record<ProjectLifecycleStatus, string> = {
  ACTIVE: "Set active",
  ON_HOLD: "Put on hold",
  COMPLETED: "Mark completed",
  ARCHIVED: "Archive",
}

export function LifecycleControls({
  projectId,
  projectName,
  status,
  allowedTargets,
  clientArchived,
  deletion,
}: {
  projectId: string
  projectName: string
  status: ProjectLifecycleStatus
  /** Allowed next statuses (PROJECT_LIFECYCLE_TRANSITIONS); empty when archived. */
  allowedTargets: ProjectLifecycleStatus[]
  clientArchived: boolean
  /** Only for an archived project: when it becomes deletable, and what (if anything) must be retained. */
  deletion: { eligibleOn: string; eligibleNow: boolean; retained: string[] } | null
}) {
  const [reason, setReason] = useState("")
  const [confirmName, setConfirmName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function run(action: () => Promise<ProjectActionState>) {
    setError(null)
    startTransition(async () => {
      let result: ProjectActionState
      try {
        result = await action()
      } catch {
        result = { error: "Could not reach the server. Nothing was changed." }
      }
      if (result?.error) {
        setError(result.error)
        return
      }
      setReason("")
    })
  }

  // Only reopening a completed project and moves under an archived client
  // need extra explanation; the database enforces both regardless.
  const reopenNeedsReason = status === "COMPLETED"

  return (
    <div className="flex flex-col gap-4">
      {clientArchived ? (
        <p className="text-sm text-muted-foreground">
          This project&apos;s client/business is archived, so the project is read-only. Restore the
          client to change it.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="lifecycle-reason">
          Reason {reopenNeedsReason ? "(required to reopen)" : "(optional)"}
        </Label>
        <Input id="lifecycle-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        {status === "ARCHIVED" ? (
          <Button
            type="button"
            variant="outline"
            disabled={isPending || clientArchived}
            onClick={() => run(() => restoreProjectAction(projectId, reason))}
          >
            Restore
          </Button>
        ) : (
          allowedTargets
            .filter((to) => !clientArchived || to === "ARCHIVED")
            .map((to) => (
              <Button
                key={to}
                type="button"
                variant={to === "ARCHIVED" ? "destructive" : "outline"}
                disabled={isPending}
                onClick={() => run(() => setProjectLifecycleAction(projectId, to, reason))}
              >
                {status === "COMPLETED" && to === "ACTIVE" ? "Reopen" : ACTION_LABELS[to]}
              </Button>
            ))
        )}
      </div>

      {status !== "ARCHIVED" ? (
        <p className="text-xs text-muted-foreground">
          Archiving makes the project read-only and revokes its share links. It can be restored later.
        </p>
      ) : null}

      {deletion ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm font-medium">Permanent deletion</p>
          {deletion.retained.length > 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="retained-history">
              This project can&apos;t be permanently deleted: it has {deletion.retained.join(", ")}, which
              are kept as history. It stays archived.
            </p>
          ) : !deletion.eligibleNow ? (
            <p className="text-sm text-muted-foreground">
              Archived projects can be permanently deleted 30 days after archiving, from{" "}
              {deletion.eligibleOn}.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Deletes the project and its answers, evidence links, targets and draft creatives. This
                can&apos;t be undone. Requires a password + TOTP sign-in within the last 5 minutes.
              </p>
              <Label htmlFor="confirm-delete-name">Type the project name to confirm</Label>
              <Input
                id="confirm-delete-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
              <div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending || confirmName !== projectName}
                  onClick={() => run(() => deleteProjectPermanentlyAction(projectId, confirmName))}
                >
                  Delete permanently
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
