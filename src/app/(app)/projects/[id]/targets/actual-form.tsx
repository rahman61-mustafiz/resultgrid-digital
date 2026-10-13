"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import { updateActualAction } from "@/app/(app)/projects/[id]/targets/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ActualForm({
  targetId,
  projectId,
  currentActual,
}: {
  targetId: string
  projectId: string
  currentActual: number | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <form
      className="flex items-center gap-2"
      action={(formData) => {
        startTransition(async () => {
          await updateActualAction(targetId, projectId, formData)
          router.refresh()
        })
      }}
    >
      <Input
        name="actual"
        type="number"
        step="any"
        defaultValue={currentActual ?? ""}
        placeholder="Actual"
        className="w-24"
      />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "..." : "Update"}
      </Button>
    </form>
  )
}
