"use client"

import { useState, useTransition } from "react"

import {
  archiveClientBusinessAction,
  deleteClientBusinessPermanentlyAction,
  restoreClientBusinessAction,
  type ClientActionState,
} from "@/app/(app)/clients/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ClientLifecycleControls({
  id,
  displayName,
  status,
  openProjectCount,
  projectCount,
  deletion,
}: {
  id: string
  displayName: string
  status: "ACTIVE" | "ARCHIVED"
  /** ACTIVE or ON_HOLD projects; archiving needs none. */
  openProjectCount: number
  projectCount: number
  /** Only when archived: when it becomes deletable. */
  deletion: { eligibleOn: string; eligibleNow: boolean } | null
}) {
  const [reason, setReason] = useState("")
  const [confirmName, setConfirmName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function run(action: () => Promise<ClientActionState>) {
    setError(null)
    startTransition(async () => {
      let result: ClientActionState
      try {
        result = await action()
      } catch {
        result = { error: "Could not reach the server. Nothing was changed." }
      }
      if (result?.error) setError(result.error)
      else setReason("")
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="client-lifecycle-reason">Reason (optional)</Label>
        <Input id="client-lifecycle-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "ARCHIVED" ? (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => restoreClientBusinessAction(id, reason))}
          >
            Restore
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() => run(() => archiveClientBusinessAction(id, reason))}
          >
            Archive
          </Button>
        )}
      </div>
      {status === "ACTIVE" ? (
        <p className="text-xs text-muted-foreground">
          {openProjectCount > 0
            ? `${openProjectCount} project(s) are active or on hold; complete or archive them before archiving this record.`
            : "Archiving makes this record and its projects read-only and revokes their share links. It can be restored later."}
        </p>
      ) : null}

      {deletion ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-sm font-medium">Permanent deletion</p>
          {projectCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              This record still has {projectCount} project(s). Projects with approval, export or financial
              history are kept, so the record is kept with them.
            </p>
          ) : !deletion.eligibleNow ? (
            <p className="text-sm text-muted-foreground">
              Archived records can be permanently deleted 30 days after archiving, from {deletion.eligibleOn}.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This can&apos;t be undone. Requires a password + TOTP sign-in within the last 5 minutes.
              </p>
              <Label htmlFor="confirm-client-delete-name">Type the name to confirm</Label>
              <Input
                id="confirm-client-delete-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
              <div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending || confirmName !== displayName}
                  onClick={() => run(() => deleteClientBusinessPermanentlyAction(id, confirmName))}
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
