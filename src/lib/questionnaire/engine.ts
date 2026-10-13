import { QUESTIONS } from "@/lib/questionnaire/v1"
import { countryName, isCountryCode } from "@/lib/questionnaire/countries"
import type {
  Condition,
  FieldDefinition,
  QuestionDefinition,
  StructuredValue,
} from "@/lib/questionnaire/types"
import type { AnswerStatus } from "@/lib/domain/enums"
import type { Json } from "@/lib/supabase/types"

/**
 * Questionnaire rules engine: conditional applicability, answer shape
 * checks (enforced on every save), and readiness issues (reported on the
 * readiness review and enforced at mark-ready and approval).
 *
 * Two levels, matching BUILD_READINESS_QUESTIONNAIRE.md F-rules ("Answers
 * autosave as drafts", "Missing or invalid items are grouped by section"):
 * - normalizeAnswerValue rejects values that cannot belong to the question
 *   at all (wrong type, unknown field, option not in the list, malformed
 *   date). Nothing like that is ever stored.
 * - answerIssues reports a well-formed but incomplete or invalid draft
 *   (too short, missing sub-field, bad URL, end before start, ...). Drafts
 *   save; readiness lists the issues and blocks completion and approval.
 */

export type AnswerRecord = {
  question_key: string
  status: AnswerStatus
  value: Json | null
}

export type QuestionContext = {
  projectType: string
  answers: ReadonlyMap<string, AnswerRecord>
}

export function buildContext(projectType: string, answers: AnswerRecord[]): QuestionContext {
  return { projectType, answers: new Map(answers.map((a) => [a.question_key, a])) }
}

export const QUESTION_BY_KEY: ReadonlyMap<string, QuestionDefinition> = new Map(
  QUESTIONS.map((q) => [q.key, q])
)

const SHORT_TEXT_HARD_CAP = 2000
const LONG_TEXT_HARD_CAP = 20000

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** true / false, or null when a controlling question is not answered yet. */
type Tri = boolean | null

function isStructured(value: Json | null): value is StructuredValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function valuesOf(value: Json | null, field: string | undefined): string[] {
  const raw = field === undefined ? value : isStructured(value) ? value[field] : undefined
  if (typeof raw === "string") return raw ? [raw] : []
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string")
  return []
}

export function isAnswered(answer: AnswerRecord | undefined): boolean {
  if (!answer) return false
  if (answer.status !== "ANSWERED" && answer.status !== "CONFIRMED") return false
  const value = answer.value
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  if (isStructured(value)) return Object.keys(value).length > 0
  return true
}

/**
 * An unanswered controller yields null. Callers treat null
 * conservatively: the question stays shown (showWhen) and stays required
 * (optionalWhen), so an unanswered earlier question can never make a
 * later requirement disappear. A controller that itself does not apply
 * counts as not matching.
 */
export function evaluateCondition(
  condition: Condition,
  ctx: QuestionContext,
  visiting: ReadonlySet<string> = new Set()
): Tri {
  if ("answer" in condition) {
    const controller = QUESTION_BY_KEY.get(condition.answer)
    if (!controller) throw new Error(`condition references unknown question ${condition.answer}`)
    if (visiting.has(controller.key)) {
      throw new Error(`condition cycle through ${controller.key}`)
    }
    if (!isApplicable(controller, ctx, new Set([...visiting, controller.key]))) return false
    const answer = ctx.answers.get(controller.key)
    if (!isAnswered(answer)) return null
    const values = valuesOf(answer!.value, condition.field)
    if (values.length === 0) return null
    return values.some((v) => condition.in.includes(v))
  }
  if ("projectType" in condition) {
    return (condition.projectType as string[]).includes(ctx.projectType)
  }
  if ("any" in condition) {
    const results = condition.any.map((c) => evaluateCondition(c, ctx, visiting))
    if (results.includes(true)) return true
    return results.includes(null) ? null : false
  }
  if ("all" in condition) {
    const results = condition.all.map((c) => evaluateCondition(c, ctx, visiting))
    if (results.includes(false)) return false
    return results.includes(null) ? null : true
  }
  const inner = evaluateCondition(condition.not, ctx, visiting)
  return inner === null ? null : !inner
}

export function isApplicable(
  question: QuestionDefinition,
  ctx: QuestionContext,
  visiting: ReadonlySet<string> = new Set([question.key])
): boolean {
  if (!question.showWhen) return true
  return evaluateCondition(question.showWhen, ctx, visiting) !== false
}

export function isRequired(question: QuestionDefinition, ctx: QuestionContext): boolean {
  if (!question.required || !isApplicable(question, ctx)) return false
  if (!question.optionalWhen) return true
  return evaluateCondition(question.optionalWhen, ctx, new Set([question.key])) !== true
}

/** Keys of the questions a condition depends on, for "why is this hidden?" text. */
export function conditionSources(condition: Condition | undefined): string[] {
  if (!condition) return []
  if ("answer" in condition) return [condition.answer]
  if ("projectType" in condition) return ["project type"]
  if ("any" in condition) return [...new Set(condition.any.flatMap(conditionSources))]
  if ("all" in condition) return [...new Set(condition.all.flatMap(conditionSources))]
  return conditionSources(condition.not)
}

// ---------------------------------------------------------------------------
// Shape normalization (save time)
// ---------------------------------------------------------------------------

export type NormalizeResult = { ok: true; value: Json | null } | { ok: false; error: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function optionValues(options: { value: string }[] | undefined): Set<string> {
  return new Set((options ?? []).map((o) => o.value))
}

function normalizeField(
  field: FieldDefinition,
  raw: unknown
): { ok: true; value: string | string[] | null } | { ok: false; error: string } {
  if (field.kind === "multi_select") {
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
      return { ok: false, error: `${field.label}: expected a list of options.` }
    }
    const allowed = optionValues(field.options)
    const unique = [...new Set(raw as string[])]
    const unknown = unique.find((v) => !allowed.has(v))
    if (unknown !== undefined) return { ok: false, error: `${field.label}: "${unknown}" is not an option.` }
    // Store in definition order so equal selections are byte-identical.
    const ordered = (field.options ?? []).map((o) => o.value).filter((v) => unique.includes(v))
    return { ok: true, value: ordered.length > 0 ? ordered : null }
  }

  if (typeof raw !== "string") return { ok: false, error: `${field.label}: expected text.` }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null }

  const cap = field.kind === "long_text" ? LONG_TEXT_HARD_CAP : SHORT_TEXT_HARD_CAP
  if (trimmed.length > cap) return { ok: false, error: `${field.label}: longer than ${cap} characters.` }

  switch (field.kind) {
    case "select":
      if (!optionValues(field.options).has(trimmed)) {
        return { ok: false, error: `${field.label}: "${trimmed}" is not an option.` }
      }
      return { ok: true, value: trimmed }
    case "date":
      if (!isIsoDate(trimmed)) return { ok: false, error: `${field.label}: not a valid date.` }
      return { ok: true, value: trimmed }
    case "country":
      if (!isCountryCode(trimmed)) return { ok: false, error: `${field.label}: not a valid country.` }
      return { ok: true, value: trimmed }
    case "currency":
      return { ok: true, value: trimmed.toUpperCase() }
    default:
      return { ok: true, value: trimmed }
  }
}

/**
 * Validates and canonicalizes a value for `question`. Returns value null
 * for an empty answer (status UNANSWERED). Rejects anything that cannot be
 * an answer to this question; accepts incomplete drafts.
 */
export function normalizeAnswerValue(question: QuestionDefinition, raw: unknown): NormalizeResult {
  if (question.type === "STRUCTURED") {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "Expected a structured answer." }
    }
    const fields = new Map((question.fields ?? []).map((f) => [f.id, f]))
    const out: StructuredValue = {}
    for (const [id, fieldRaw] of Object.entries(raw as Record<string, unknown>)) {
      const field = fields.get(id)
      if (!field) return { ok: false, error: `Unknown field "${id}".` }
      const result = normalizeField(field, fieldRaw)
      if (!result.ok) return result
      if (result.value !== null) out[id] = result.value
    }
    // Field order follows the definition, not the caller.
    const ordered: StructuredValue = {}
    for (const f of question.fields ?? []) if (out[f.id] !== undefined) ordered[f.id] = out[f.id]
    return { ok: true, value: Object.keys(ordered).length > 0 ? ordered : null }
  }

  if (typeof raw !== "string") return { ok: false, error: "Expected text." }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null }

  if (question.type === "SINGLE_SELECT") {
    if (!optionValues(question.options).has(trimmed)) return { ok: false, error: `"${trimmed}" is not an option.` }
    return { ok: true, value: trimmed }
  }
  if (question.type === "DATE") {
    if (!isIsoDate(trimmed)) return { ok: false, error: "Not a valid date." }
    return { ok: true, value: trimmed }
  }
  const cap = question.type === "LONG_TEXT" ? LONG_TEXT_HARD_CAP : SHORT_TEXT_HARD_CAP
  if (trimmed.length > cap) return { ok: false, error: `Longer than ${cap} characters.` }
  return { ok: true, value: trimmed }
}

// ---------------------------------------------------------------------------
// Readiness issues
// ---------------------------------------------------------------------------

/** An http(s) URL or a bare domain such as example.com or www.example.com/page. */
export function isUrlOrDomain(value: string): boolean {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)
  } catch {
    return false
  }
}

const NON_NEGATIVE_NUMBER = /^\d+(\.\d+)?$/

function lengthIssues(label: string, text: string, min?: number, max?: number): string[] {
  if (min !== undefined && text.length < min) return [`${label} must be at least ${min} characters.`]
  if (max !== undefined && text.length > max) return [`${label} must be at most ${max} characters.`]
  return []
}

function fieldIssues(
  field: FieldDefinition,
  value: string | string[] | undefined,
  all: StructuredValue,
  ctx: QuestionContext
): string[] {
  const requiredBySibling =
    field.requiredWhen !== undefined &&
    valuesOf(all, field.requiredWhen.field).some((v) => field.requiredWhen!.in.includes(v))
  if (value === undefined) {
    return field.required || requiredBySibling ? [`${field.label} is required.`] : []
  }

  if (Array.isArray(value)) {
    const issues: string[] = []
    if (field.minCount !== undefined && value.length < field.minCount) {
      issues.push(`${field.label}: choose at least ${field.minCount}.`)
    }
    if (field.maxCount !== undefined && value.length > field.maxCount) {
      issues.push(`${field.label}: choose at most ${field.maxCount}.`)
    }
    const exclusive = (field.exclusive ?? []).find((v) => value.includes(v))
    if (exclusive !== undefined && value.length > 1) {
      issues.push(`${field.label}: "${exclusive}" cannot be combined with other choices.`)
    }
    for (const must of field.mustInclude ?? []) {
      if (!value.includes(must)) issues.push(`${field.label}: "${must}" must be included.`)
    }
    return issues
  }

  const issues = lengthIssues(field.label, value, field.minLength, field.maxLength)
  if (field.kind === "url" && !isUrlOrDomain(value)) {
    issues.push(`${field.label} must be a valid web address (e.g. https://example.com).`)
  }
  if (field.kind === "currency" && !/^[A-Z]{3}$/.test(value)) {
    issues.push(`${field.label} must be a 3-letter ISO currency code (e.g. BDT, USD).`)
  }
  if (field.kind === "number") {
    if (!NON_NEGATIVE_NUMBER.test(value)) {
      issues.push(`${field.label} must be a non-negative number.`)
    } else if (field.min !== undefined && Number(value) < field.min) {
      issues.push(`${field.label} must be at least ${field.min}.`)
    }
  }
  const optionRule = field.optionConditions?.[value]
  if (optionRule && evaluateCondition(optionRule.when, ctx) === false) {
    issues.push(optionRule.message)
  }
  if (field.draftOnlyValues?.some((v) => v.toLowerCase() === value.toLowerCase())) {
    issues.push(`${field.label}: "${value}" is only allowed while drafting.`)
  }
  return issues
}

function ruleIssues(question: QuestionDefinition, value: StructuredValue): string[] {
  const issues: string[] = []
  for (const rule of question.rules ?? []) {
    const a = value[rule.field]
    const b = value[rule.kind === "oneOfSelected" ? rule.from : rule.than]
    if (rule.kind === "gte") {
      if (typeof a !== "string" || typeof b !== "string") continue
      const comparable = isIsoDate(a) && isIsoDate(b)
        ? a >= b
        : NON_NEGATIVE_NUMBER.test(a) && NON_NEGATIVE_NUMBER.test(b)
          ? Number(a) >= Number(b)
          : true
      if (!comparable) issues.push(rule.message)
    } else if (rule.kind === "oneOfSelected") {
      if (typeof a === "string" && !(Array.isArray(b) && b.includes(a))) issues.push(rule.message)
    } else {
      if (typeof a !== "string") continue
      const lines = a.split("\n").map((l) => l.trim()).filter(Boolean)
      if (lines.length === 1 && rule.allow.some((v) => v.toLowerCase() === lines[0].toLowerCase())) continue
      const start = typeof b === "string" ? b : undefined
      const bad = lines.some((line) => {
        const date = line.slice(0, 10)
        return !isIsoDate(date) || (start !== undefined && date < start)
      })
      if (bad) issues.push(rule.message)
    }
  }
  return issues
}

/**
 * Issues with a supplied (non-empty) answer. Empty answers are handled by
 * computeReadiness.
 *
 * The stored value is first re-checked with the same shape rules as a save
 * (normalizeAnswerValue): a value that reached the database some other way
 * -- a direct RPC call, an older app version, a hand edit -- must not count
 * as valid just because its later checks happen to pass. Readiness, and
 * therefore mark-ready and approval, never trusts the stored shape.
 */
export function answerIssues(
  question: QuestionDefinition,
  storedValue: Json | null,
  ctx: QuestionContext
): string[] {
  const shape = normalizeAnswerValue(question, storedValue)
  if (!shape.ok) return [`Stored answer is not valid for this question: ${shape.error}`]
  if (shape.value === null) return ["Not answered."]
  const value = shape.value

  if (question.type === "STRUCTURED") {
    if (!isStructured(value)) return ["Answer is not in the expected structured format."]
    const issues = (question.fields ?? []).flatMap((f) => fieldIssues(f, value[f.id], value, ctx))
    return [...issues, ...ruleIssues(question, value)]
  }
  if (typeof value !== "string") return ["Answer is not in the expected format."]
  if (question.type === "SHORT_TEXT" || question.type === "LONG_TEXT") {
    return lengthIssues("Answer", value, question.minLength, question.maxLength)
  }
  return []
}

// ---------------------------------------------------------------------------
// Display / export formatting
// ---------------------------------------------------------------------------

function optionLabel(options: { value: string; label: string }[] | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value
}

function formatField(field: FieldDefinition, value: string | string[]): string {
  if (Array.isArray(value)) return value.map((v) => optionLabel(field.options, v)).join(", ")
  if (field.kind === "select") return optionLabel(field.options, value)
  if (field.kind === "country") return `${countryName(value)} (${value})`
  return value
}

/** Deterministic plain-text rendering used by the Markdown export. */
export function formatAnswerValue(question: QuestionDefinition, value: Json | null): string {
  if (value === null) return ""
  if (question.type === "SINGLE_SELECT" && typeof value === "string") {
    return optionLabel(question.options, value)
  }
  if (question.type === "STRUCTURED" && isStructured(value)) {
    const lines: string[] = []
    for (const field of question.fields ?? []) {
      const v = value[field.id]
      if (v === undefined) continue
      const text = formatField(field, v)
      if (text.includes("\n")) {
        lines.push(`- ${field.label}:`)
        for (const line of text.split("\n")) lines.push(`  ${line}`)
      } else {
        lines.push(`- ${field.label}: ${text}`)
      }
    }
    return lines.join("\n")
  }
  return typeof value === "string" ? value : JSON.stringify(value)
}
