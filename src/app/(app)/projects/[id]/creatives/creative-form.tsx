"use client"

import { useActionState } from "react"

import { createCreativeAction } from "@/app/(app)/projects/[id]/creatives/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function CreativeForm({ projectId }: { projectId: string }) {
  const action = createCreativeAction.bind(null, projectId)
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="title">Title *</Label>
          <Input id="title" name="title" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel">Channel</Label>
          <Input id="channel" name="channel" placeholder="Facebook, Instagram..." />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="format">Format</Label>
          <Input id="format" name="format" placeholder="Static, carousel, video..." />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="plannedDate">Planned date</Label>
          <Input id="plannedDate" name="plannedDate" type="date" />
        </div>
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Create creative"}
        </Button>
      </div>
    </form>
  )
}
