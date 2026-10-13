"use client"

import { useActionState, useState } from "react"

import {
  addFinancialRecordAction,
  type FinancialRecordFormState,
} from "@/app/(app)/projects/[id]/financials/actions"
import {
  ATTRIBUTABLE_RECORD_TYPE,
  EVIDENCE_STATUSES,
  FINANCIAL_RECORD_TYPE_LABELS,
  FINANCIAL_RECORD_TYPES,
  VALUE_STATUSES,
} from "@/lib/domain/enums"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const initialState: FinancialRecordFormState = null

export function FinancialRecordForm({
  projectId,
  currency,
}: {
  projectId: string
  currency: string
}) {
  const action = addFinancialRecordAction.bind(null, projectId)
  const [state, formAction, isPending] = useActionState(action, initialState)
  const [recordType, setRecordType] = useState<string>(FINANCIAL_RECORD_TYPES[0])
  const [evidenceStatus, setEvidenceStatus] = useState<string>("OWNER_REPORTED")

  const canAttribute = recordType === ATTRIBUTABLE_RECORD_TYPE
  const hasEvidence = evidenceStatus !== "UNVERIFIED"

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="recordType">Record type *</Label>
          <Select name="recordType" defaultValue={recordType} onValueChange={setRecordType}>
            <SelectTrigger id="recordType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FINANCIAL_RECORD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FINANCIAL_RECORD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="amount">Amount ({currency}) *</Label>
          <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="valueStatus">Value status *</Label>
          <Select name="valueStatus" defaultValue="CONFIRMED">
            <SelectTrigger id="valueStatus" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="periodStart">Period start *</Label>
          <Input id="periodStart" name="periodStart" type="date" required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="periodEnd">Period end *</Label>
          <Input id="periodEnd" name="periodEnd" type="date" required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="evidenceStatus">Evidence status *</Label>
          <Select
            name="evidenceStatus"
            defaultValue={evidenceStatus}
            onValueChange={setEvidenceStatus}
          >
            <SelectTrigger id="evidenceStatus" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVIDENCE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="evidenceUrl">Evidence link</Label>
          <Input id="evidenceUrl" name="evidenceUrl" type="url" placeholder="https://..." />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>

        {canAttribute ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="attributedToMarketing"
                disabled={!hasEvidence}
                className="size-4"
              />
              Attribute this revenue to marketing
            </label>
            <p className="text-xs text-muted-foreground">
              {hasEvidence
                ? "Counts toward the client-facing \"profit from marketing\" figure. Only check this when the revenue is actually traceable to a marketing-driven source, not just any client revenue in the period."
                : "Requires an evidence status other than Unverified before this can be checked -- per policy, marketing-attributed revenue is never claimed without evidence."}
            </p>
          </div>
        ) : null}
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Add record"}
        </Button>
      </div>
    </form>
  )
}
