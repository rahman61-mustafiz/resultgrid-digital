"use client"

import { useState, useTransition } from "react"

import { saveAnswerAction, setAnswerStatusAction } from "@/app/(app)/projects/[id]/questionnaire/actions"
import type { FieldDefinition, QuestionDefinition, StructuredValue } from "@/lib/questionnaire/types"
import { COUNTRY_CODES, countryName } from "@/lib/questionnaire/countries"
import { Badge } from "@/components/ui/badge"
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

const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort(
  (a, b) => a.label.localeCompare(b.label)
)

type AnswerValue = string | StructuredValue

function SelectField({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose one" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StructuredField({
  baseId,
  field,
  value,
  required,
  onDraft,
  onCommit,
}: {
  baseId: string
  field: FieldDefinition
  value: string | string[] | undefined
  required: boolean
  onDraft: (value: string | string[]) => void
  onCommit: (value: string | string[]) => void
}) {
  const id = `${baseId}-${field.id}`
  const text = typeof value === "string" ? value : ""
  const list = Array.isArray(value) ? value : []

  let control
  if (field.kind === "select") {
    control = <SelectField id={id} value={text} options={field.options ?? []} onChange={onCommit} />
  } else if (field.kind === "country") {
    control = <SelectField id={id} value={text} options={COUNTRY_OPTIONS} onChange={onCommit} />
  } else if (field.kind === "multi_select") {
    control = (
      <div id={id} className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label={field.label}>
        {(field.options ?? []).map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={list.includes(opt.value)}
              onChange={(e) =>
                onCommit(e.target.checked ? [...list, opt.value] : list.filter((v) => v !== opt.value))
              }
            />
            {opt.label}
          </label>
        ))}
      </div>
    )
  } else if (field.kind === "long_text") {
    control = (
      <Textarea id={id} value={text} rows={3} onChange={(e) => onDraft(e.target.value)} onBlur={() => onCommit(text)} />
    )
  } else {
    control = (
      <Input
        id={id}
        type={field.kind === "date" ? "date" : "text"}
        inputMode={field.kind === "number" ? "decimal" : undefined}
        value={text}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={() => onCommit(text)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={field.kind === "multi_select" ? undefined : id} className="text-xs font-medium">
        {field.label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {control}
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
    </div>
  )
}

function isFieldRequired(field: FieldDefinition, value: StructuredValue): boolean {
  if (field.required) return true
  if (!field.requiredWhen) return false
  const sibling = value[field.requiredWhen.field]
  const selected = Array.isArray(sibling) ? sibling : sibling ? [sibling] : []
  return selected.some((v) => field.requiredWhen!.in.includes(v))
}

export function QuestionField({
  projectId,
  question,
  initialValue,
  initialStatus,
  initialIssues,
  required,
}: {
  projectId: string
  question: QuestionDefinition
  initialValue: AnswerValue | null
  initialStatus: string
  initialIssues: string[]
  /** Whether the question is required under the project's current answers. */
  required: boolean
}) {
  const structured = question.type === "STRUCTURED"
  const [value, setValue] = useState<AnswerValue>(initialValue ?? (structured ? {} : ""))
  const [status, setStatus] = useState(initialStatus)
  const [issues, setIssues] = useState(initialIssues)
  const [isPending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function save(newValue: AnswerValue) {
    setError(null)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof saveAnswerAction>>
      try {
        result = await saveAnswerAction(projectId, question.key, newValue)
      } catch {
        result = { error: "Could not reach the server. Your answer was not saved.", issues: [] }
      }
      if (result.error) {
        // Clear any earlier "Saved" so a failed save is never shown as saved.
        setSavedAt(null)
        setError(result.error)
        return
      }
      const empty =
        typeof newValue === "string" ? !newValue.trim() : Object.values(newValue).every((v) => v.length === 0)
      setStatus(empty ? "UNANSWERED" : "ANSWERED")
      setIssues(result.issues)
      setSavedAt(Date.now())
    })
  }

  function toggleNotApplicable() {
    const next = status === "NOT_APPLICABLE" ? "UNANSWERED" : "NOT_APPLICABLE"
    setError(null)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setAnswerStatusAction>>
      try {
        result = await setAnswerStatusAction(projectId, question.key, next)
      } catch {
        result = { error: "Could not reach the server. Nothing was changed." }
      }
      if (result.error) {
        setSavedAt(null)
        setError(result.error)
        return
      }
      setStatus(next)
      if (next === "NOT_APPLICABLE") setValue(structured ? {} : "")
      setIssues([])
      setSavedAt(Date.now())
    })
  }

  const isNotApplicable = status === "NOT_APPLICABLE"
  const fieldId = `q-${question.key}`
  const structuredValue = typeof value === "string" ? {} : value
  const textValue = typeof value === "string" ? value : ""

  function setField(fieldId: string, fieldValue: string | string[]): StructuredValue {
    const next = { ...structuredValue }
    if (fieldValue.length === 0) delete next[fieldId]
    else next[fieldId] = fieldValue
    setValue(next)
    return next
  }

  let control
  if (isNotApplicable) {
    control = <p className="text-sm text-muted-foreground italic">Marked not applicable.</p>
  } else if (structured) {
    control = (
      <div className="flex flex-col gap-3">
        {(question.fields ?? []).map((field) => (
          <StructuredField
            key={field.id}
            baseId={fieldId}
            field={field}
            value={structuredValue[field.id]}
            required={required && isFieldRequired(field, structuredValue)}
            onDraft={(v) => setField(field.id, v)}
            onCommit={(v) => save(setField(field.id, v))}
          />
        ))}
      </div>
    )
  } else if (question.type === "SINGLE_SELECT") {
    control = (
      <SelectField
        id={fieldId}
        value={textValue}
        options={question.options ?? []}
        onChange={(v) => {
          setValue(v)
          save(v)
        }}
      />
    )
  } else if (question.type === "LONG_TEXT") {
    control = (
      <Textarea
        id={fieldId}
        value={textValue}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => save(textValue)}
        rows={3}
      />
    )
  } else {
    control = (
      <Input
        id={fieldId}
        type={question.type === "DATE" ? "date" : "text"}
        value={textValue}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => save(textValue)}
      />
    )
  }

  return (
    <div id={structured ? fieldId : undefined} className="flex flex-col gap-2 border-b py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <Label htmlFor={structured ? undefined : fieldId} className="flex-1 text-sm font-medium">
          {question.question}
          {required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
        <div className="flex items-center gap-2">
          {isPending ? (
            <span className="text-xs text-muted-foreground">Saving...</span>
          ) : savedAt ? (
            <span className="text-xs text-muted-foreground">Saved</span>
          ) : null}
          <Badge variant={isNotApplicable ? "secondary" : "outline"}>{status}</Badge>
        </div>
      </div>

      {control}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{question.purpose}</p>
        {required && !isNotApplicable ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={toggleNotApplicable}>
            {isNotApplicable ? "Undo not applicable" : "Not applicable"}
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          Not saved: {error}
        </p>
      ) : null}
      {issues.length > 0 && !isNotApplicable ? (
        <ul className="ml-4 list-disc text-xs text-amber-700 dark:text-amber-400" data-testid="answer-issues">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
