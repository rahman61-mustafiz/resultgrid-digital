"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { updateCreativeStatusAction } from "@/app/(app)/projects/[id]/creatives/actions"
import { CREATIVE_STATUSES } from "@/lib/domain/enums"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function StatusForm({
  creativeId,
  projectId,
  currentStatus,
}: {
  creativeId: string
  projectId: string
  currentStatus: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState(currentStatus)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-3"
      action={(formData) => {
        setError(null)
        startTransition(async () => {
          try {
            await updateCreativeStatusAction(creativeId, projectId, formData)
            router.refresh()
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not update status.")
          }
        })
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="status">Status</Label>
        <Select name="status" value={status} onValueChange={setStatus}>
          <SelectTrigger id="status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREATIVE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {status === "APPROVED" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="approvalNote">Approval note (optional)</Label>
          <Input id="approvalNote" name="approvalNote" />
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving..." : "Update status"}
        </Button>
      </div>
    </form>
  )
}
