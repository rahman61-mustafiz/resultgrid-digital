import { QUESTIONS } from "@/lib/questionnaire/v1"
import {
  answerIssues,
  buildContext,
  isAnswered,
  isApplicable,
  isRequired,
  type AnswerRecord,
  type QuestionContext,
} from "@/lib/questionnaire/engine"
import type { QuestionDefinition } from "@/lib/questionnaire/types"

export type { AnswerRecord } from "@/lib/questionnaire/engine"

export type ReadinessProblem = { question: QuestionDefinition; issues: string[] }

export type ReadinessResult = {
  totalRequired: number
  completed: number
  /** Missing required answers and invalid supplied answers, in questionnaire order. */
  problems: ReadinessProblem[]
  /** Questions whose condition excludes them for this project's current answers. */
  notApplicable: QuestionDefinition[]
  isComplete: boolean
  completionPercent: number
}

/**
 * A required question is satisfied only by an ANSWERED/CONFIRMED value with
 * no issues. NOT_APPLICABLE never satisfies a required question: "Do not
 * let a required question pass approval via unrestricted NOT_APPLICABLE".
 * A question that genuinely doesn't apply is excluded by its own condition
 * (showWhen, see engine.ts), computed from earlier answers and the project
 * type -- not by a flag the user can set. Optional questions (including
 * ones made optional by optionalWhen) may still be marked not applicable.
 *
 * A supplied answer that has issues blocks completion even when the
 * question is optional, because it would otherwise be exported as-is.
 */
export function computeReadiness(answers: AnswerRecord[], projectType: string): ReadinessResult {
  return computeReadinessFor(buildContext(projectType, answers))
}

export function computeReadinessFor(ctx: QuestionContext): ReadinessResult {
  const problems: ReadinessProblem[] = []
  const notApplicable: QuestionDefinition[] = []
  let totalRequired = 0
  let completed = 0

  for (const question of QUESTIONS) {
    if (!isApplicable(question, ctx)) {
      notApplicable.push(question)
      continue
    }
    const required = isRequired(question, ctx)
    if (required) totalRequired++
    const answer = ctx.answers.get(question.key)

    if (answer?.status === "NOT_APPLICABLE") {
      if (required) {
        problems.push({ question, issues: ["Required -- it cannot be marked not applicable."] })
      }
      continue
    }
    if (!isAnswered(answer)) {
      if (required) problems.push({ question, issues: ["Not answered."] })
      continue
    }
    const issues = answerIssues(question, answer!.value, ctx)
    if (issues.length > 0) {
      problems.push({ question, issues })
      continue
    }
    if (required) completed++
  }

  return {
    totalRequired,
    completed,
    problems,
    notApplicable,
    isComplete: problems.length === 0,
    completionPercent: totalRequired === 0 ? 100 : Math.round((completed / totalRequired) * 100),
  }
}
