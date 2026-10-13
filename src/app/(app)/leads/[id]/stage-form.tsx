"use client"

import { useActionState, useState } from "react"

import { updateLeadStageAction } from "@/app/(app)/leads/actions"
import { LEAD_STAGES } from "@/lib/domain/enums"
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

export function StageForm({
  leadId,
  currentStage,
}: {
  leadId: string
  currentStage: string
}) {
  const action = updateLeadStageAction.bind(null, leadId)
  const [state, formAction, isPending] = useActionState(action, null)
  const [stage, setStage] = useState(currentStage)
  const needsReason = stage === "QUALIFIED" || stage === "LOST"

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="stage">Stage</Label>
        <Select name="stage" value={stage} onValueChange={setStage}>
          <SelectTrigger id="stage" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {needsReason ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="qualificationReason">Reason *</Label>
          <Input id="qualificationReason" name="qualificationReason" required />
        </div>
      ) : null}

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? "Saving..." : "Update stage"}
        </Button>
      </div>
    </form>
  )
}
