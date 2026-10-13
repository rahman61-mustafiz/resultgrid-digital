"use client"

import { useActionState } from "react"

import { addTargetAction } from "@/app/(app)/projects/[id]/targets/actions"
import { TARGET_METRICS, TARGET_METRIC_LABELS } from "@/lib/domain/enums"
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

export function TargetForm({ projectId }: { projectId: string }) {
  const action = addTargetAction.bind(null, projectId)
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="metric">Metric *</Label>
          <Select name="metric" defaultValue={TARGET_METRICS[0]}>
            <SelectTrigger id="metric" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGET_METRICS.map((m) => (
                <SelectItem key={m} value={m}>
                  {TARGET_METRIC_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="unit">Unit *</Label>
          <Input id="unit" name="unit" placeholder="count, %, BDT..." required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="baseline">Baseline</Label>
          <Input id="baseline" name="baseline" type="number" step="any" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="target">Target *</Label>
          <Input id="target" name="target" type="number" step="any" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="periodStart">Period start *</Label>
          <Input id="periodStart" name="periodStart" type="date" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="periodEnd">Period end *</Label>
          <Input id="periodEnd" name="periodEnd" type="date" required />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="actualSource">Actual value source</Label>
          <Input id="actualSource" name="actualSource" placeholder="Where the actual comes from" />
        </div>
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Add target"}
        </Button>
      </div>
    </form>
  )
}
