import type { ProjectType } from "@/lib/domain/enums"

export type QuestionType = "SHORT_TEXT" | "LONG_TEXT" | "SINGLE_SELECT" | "DATE" | "STRUCTURED"

export type QuestionSensitivity = "NORMAL" | "INTERNAL" | "SENSITIVE"

export type QuestionOption = { value: string; label: string }

/**
 * A condition over earlier answers and the project type
 * (BUILD_READINESS_QUESTIONNAIRE.md F05: "Conditional questions appear or
 * become required based on prior answers and project type").
 *
 * `answer` matches when the controlling question's value -- or, for a
 * STRUCTURED question, the value of `field` -- is (or, for a multi-select,
 * includes) one of `in`. See evaluateCondition in engine.ts for how an
 * unanswered controller is treated.
 */
export type Condition =
  | { answer: string; field?: string; in: string[] }
  | { projectType: ProjectType[] }
  | { any: Condition[] }
  | { all: Condition[] }
  | { not: Condition }

export type FieldKind =
  | "short_text"
  | "long_text"
  | "select"
  | "multi_select"
  | "date"
  | "country"
  | "currency"
  | "url"
  | "number"

/** A condition on another field of the same STRUCTURED answer. */
export type FieldCondition = { field: string; in: string[] }

export type FieldDefinition = {
  id: string
  label: string
  kind: FieldKind
  help?: string
  options?: QuestionOption[]
  /** Required whenever the question itself is required. */
  required?: boolean
  /** Required (when the question is required) only if this sibling condition holds. */
  requiredWhen?: FieldCondition
  minLength?: number
  maxLength?: number
  /** number: smallest allowed value. */
  min?: number
  /** multi_select: selection count bounds. */
  minCount?: number
  maxCount?: number
  /** multi_select: options that cannot be combined with any other selection (e.g. "None"). */
  exclusive?: string[]
  /** multi_select: options that must always be selected. */
  mustInclude?: string[]
  /** select: options only valid while a question-level condition holds. */
  optionConditions?: Record<string, { when: Condition; message: string }>
  /** Values that are allowed while drafting but not at readiness (e.g. "No exclusions identified yet"). */
  draftOnlyValues?: string[]
}

/** Cross-field rules inside one STRUCTURED answer. */
export type FieldRule =
  /** `field` must be >= `than` (numbers, or ISO dates compared as dates). */
  | { kind: "gte"; field: string; than: string; message: string }
  /** select `field` must be one of the values chosen in multi_select `from`. */
  | { kind: "oneOfSelected"; field: string; from: string; message: string }
  /** Every line of long_text `field` starts with an ISO date not before date field `than`. */
  | { kind: "datedLines"; field: string; than: string; allow: string[]; message: string }

export type QuestionDefinition = {
  key: string
  section: string
  sectionTitle: string
  question: string
  purpose: string
  type: QuestionType
  /** SINGLE_SELECT options. */
  options?: QuestionOption[]
  /** STRUCTURED fields; the stored value is an object keyed by field id. */
  fields?: FieldDefinition[]
  rules?: FieldRule[]
  /** SHORT_TEXT/LONG_TEXT length bounds from the draft, checked at readiness. */
  minLength?: number
  maxLength?: number
  /** Base requirement while the question applies. */
  required: boolean
  /** The question only applies (is shown, can be required, is exported) while this holds. */
  showWhen?: Condition
  /** A required question becomes optional while this holds. */
  optionalWhen?: Condition
  sensitivity: QuestionSensitivity
  /** Where this answer appears in PROJECT_CONTEXT.md, per the export template. */
  exportDestination: string
}

/** A STRUCTURED answer as stored in project_answers.value. */
export type StructuredValue = Record<string, string | string[]>
