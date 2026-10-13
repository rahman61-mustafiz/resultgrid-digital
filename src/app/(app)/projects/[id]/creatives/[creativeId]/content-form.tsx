"use client"

import { useActionState } from "react"

import { updateCreativeContentAction } from "@/app/(app)/projects/[id]/creatives/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ContentForm({
  creativeId,
  projectId,
  copy,
  assetUrl,
}: {
  creativeId: string
  projectId: string
  copy: string
  assetUrl: string
}) {
  const action = updateCreativeContentAction.bind(null, creativeId, projectId)
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="copy">Copy</Label>
        <Textarea id="copy" name="copy" rows={5} defaultValue={copy} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="assetUrl">Asset link</Label>
        <Input id="assetUrl" name="assetUrl" type="url" defaultValue={assetUrl} />
      </div>
      <p className="text-xs text-muted-foreground">
        Saving creates a new version. If this creative was approved or
        published, saving moves it back to Changes requested.
      </p>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save new version"}
        </Button>
      </div>
    </form>
  )
}
