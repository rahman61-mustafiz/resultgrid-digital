"use client"

import { useActionState, useState } from "react"

import {
  correctFinancialRecordAction,
  setFinancialRecordAttributionAction,
  type CorrectionFormState,
  type AttributionFormState,
} from "@/app/(app)/projects/[id]/financials/actions"
import { ATTRIBUTABLE_RECORD_TYPE, EVIDENCE_STATUSES } from "@/lib/domain/enums"
import { Badge } from "@/components/ui/badge"
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

const initialCorrectionState: CorrectionFormState = null
const initialAttributionState: AttributionFormState = null

export function RecordRow({
  projectId,
  record,
  currency,
}: {
  projectId: string
  record: {
    id: string
    record_type: string
    amount: number
    value_status: string
    period_start: string
    period_end: string
    evidence_status: string
    evidence_url: string | null
    notes: string | null
    correction_history: unknown
    attributed_to_marketing?: boolean
  }
  currency: string
}) {
  const [showCorrection, setShowCorrection] = useState(false)
  const [showAttribution, setShowAttribution] = useState(false)
  const correctionAction = correctFinancialRecordAction.bind(null, record.id, projectId)
  const [correctionState, correctionFormAction, isCorrecting] = useActionState(
    correctionAction,
    initialCorrectionState
  )
  const attributionAction = setFinancialRecordAttributionAction.bind(null, record.id, projectId)
  const [attributionState, attributionFormAction, isAttributing] = useActionState(
    attributionAction,
    initialAttributionState
  )

  const correctionCount = Array.isArray(record.correction_history)
    ? record.correction_history.length
    : 0
  const canAttribute = record.record_type === ATTRIBUTABLE_RECORD_TYPE

  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-center justify-between text-sm">
        <div className="flex flex-col">
          <span className="font-medium">
            {currency} {record.amount.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">
            {record.period_start} to {record.period_end}
            {correctionCount > 0 ? ` · corrected ${correctionCount}x` : ""}
          </span>
          {record.notes ? (
            <span className="text-xs text-muted-foreground">{record.notes}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{record.value_status}</Badge>
          <Badge variant="outline">{record.evidence_status}</Badge>
          {record.attributed_to_marketing ? (
            <Badge variant="secondary">Attributed to marketing</Badge>
          ) : null}
          {canAttribute ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAttribution((v) => !v)}
            >
              Evidence &amp; attribution
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowCorrection((v) => !v)}
          >
            Correct
          </Button>
        </div>
      </div>

      {showAttribution ? (
        <form
          action={attributionFormAction}
          className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`evidenceStatus-${record.id}`} className="text-xs">
              Evidence status
            </Label>
            <Select name="evidenceStatus" defaultValue={record.evidence_status}>
              <SelectTrigger id={`evidenceStatus-${record.id}`} className="w-40">
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
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`evidenceUrl-${record.id}`} className="text-xs">
              Evidence link
            </Label>
            <Input
              id={`evidenceUrl-${record.id}`}
              name="evidenceUrl"
              type="url"
              defaultValue={record.evidence_url ?? ""}
              placeholder="https://..."
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="attributedToMarketing"
              defaultChecked={record.attributed_to_marketing}
              className="size-4"
            />
            Attribute to marketing
          </label>
          <Button type="submit" size="sm" disabled={isAttributing}>
            {isAttributing ? "Saving..." : "Save"}
          </Button>
          {attributionState?.error ? (
            <p className="w-full text-xs text-destructive" role="alert">
              {attributionState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {showCorrection ? (
        <form
          action={correctionFormAction}
          className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`newAmount-${record.id}`} className="text-xs">
              Corrected amount
            </Label>
            <Input
              id={`newAmount-${record.id}`}
              name="newAmount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={record.amount}
              className="w-32"
              required
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`reason-${record.id}`} className="text-xs">
              Reason (required)
            </Label>
            <Input id={`reason-${record.id}`} name="reason" required />
          </div>
          <Button type="submit" size="sm" disabled={isCorrecting}>
            {isCorrecting ? "Saving..." : "Save correction"}
          </Button>
          {correctionState?.error ? (
            <p className="w-full text-xs text-destructive" role="alert">
              {correctionState.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
