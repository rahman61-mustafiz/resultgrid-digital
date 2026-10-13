"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getQuestion, questionnaireVersion } from "@/lib/questionnaire/v1"
import { computeReadinessFor } from "@/lib/questionnaire/readiness"
import {
  answerIssues,
  buildContext,
  isRequired,
  normalizeAnswerValue,
  type AnswerRecord,
  type QuestionContext,
} from "@/lib/questionnaire/engine"
import type { AnswerStatus } from "@/lib/domain/enums"
import type { Json } from "@/lib/supabase/types"
import { ruleErrorMessage } from "@/lib/domain/rule-errors"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type SaveAnswerResult = {
  error: string | null
  /** Readiness issues with the saved answer (drafts save even when this is non-empty). */
  issues: string[]
}

/**
 * The project's CURRENT answers (read fresh, not memoized) with
 * `pendingAnswer` merged in, as a rules context. Used both to check the
 * pending answer against conditions and to project what readiness becomes
 * -- before the write, so the projected status can be applied by
 * upsert_project_answer in the same transaction as the write itself.
 * Question definitions live in src/lib/questionnaire/, not SQL, so the
 * projection has to happen here rather than inside the RPC.
 */
async function loadContextWith(
  supabase: SupabaseServerClient,
  projectId: string,
  pendingAnswer: AnswerRecord
): Promise<{ ok: true; ctx: QuestionContext } | { ok: false }> {
  const [{ data: project, error: projectError }, { data: answers, error: answersError }] =
    await Promise.all([
      supabase.from("projects").select("project_type").eq("id", projectId).maybeSingle(),
      supabase.from("project_answers").select("question_key, status, value").eq("project_id", projectId),
    ])
  if (projectError || answersError || !project) return { ok: false }

  const merged = new Map<string, AnswerRecord>(
    (answers ?? []).map((a) => [a.question_key, a as AnswerRecord])
  )
  merged.set(pendingAnswer.question_key, pendingAnswer)
  return { ok: true, ctx: buildContext(project.project_type, [...merged.values()]) }
}

function nextReadinessStatus(ctx: QuestionContext): "INCOMPLETE" | "READY_FOR_REVIEW" {
  return computeReadinessFor(ctx).isComplete ? "READY_FOR_REVIEW" : "INCOMPLETE"
}

/**
 * `value` is text for SHORT_TEXT/LONG_TEXT/SINGLE_SELECT/DATE questions
 * and an object keyed by field id for STRUCTURED ones. Unknown question
 * keys and values that cannot belong to the question are rejected here
 * (and unknown keys again by upsert_project_answer itself); incomplete
 * drafts are saved and their issues returned.
 */
export async function saveAnswerAction(
  projectId: string,
  questionKey: string,
  value: unknown
): Promise<SaveAnswerResult> {
  await assertEditingAllowed()
  const question = getQuestion(questionKey)
  if (!question) {
    return { error: "Unknown question.", issues: [] }
  }

  const normalized = normalizeAnswerValue(question, value)
  if (!normalized.ok) {
    return { error: normalized.error, issues: [] }
  }

  const status: AnswerStatus = normalized.value === null ? "UNANSWERED" : "ANSWERED"
  const answerValue = normalized.value as Json

  const supabase = await createClient()
  const loaded = await loadContextWith(supabase, projectId, {
    question_key: questionKey,
    status,
    value: answerValue,
  })
  if (!loaded.ok) {
    return { error: "Could not save this answer.", issues: [] }
  }

  // The write and its readiness invalidation (if any) happen together
  // inside upsert_project_answer -- see
  // supabase/migrations/20260922150000_atomic_mutation_invalidation.sql.
  // Direct writes to project_answers are revoked for the authenticated
  // role; this RPC is the only path.
  const { error } = await supabase.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: questionKey,
    p_questionnaire_version: questionnaireVersion,
    p_status: status,
    p_value: answerValue,
    p_next_readiness_status: nextReadinessStatus(loaded.ctx),
  })

  if (error) {
    // e.g. "This project is archived and read-only: restore it first."
    return { error: ruleErrorMessage(error, "Could not save this answer."), issues: [] }
  }

  revalidatePath(`/projects/${projectId}/questionnaire`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return {
    error: null,
    issues: answerValue === null ? [] : answerIssues(question, answerValue, loaded.ctx),
  }
}

export async function setAnswerStatusAction(
  projectId: string,
  questionKey: string,
  status: Extract<AnswerStatus, "NOT_APPLICABLE" | "UNANSWERED">
) {
  await assertEditingAllowed()
  const question = getQuestion(questionKey)
  if (!question) {
    return { error: "Unknown question." }
  }

  const supabase = await createClient()
  const loaded = await loadContextWith(supabase, projectId, {
    question_key: questionKey,
    status,
    value: null,
  })
  if (!loaded.ok) {
    return { error: "Could not update this answer." }
  }

  // Server-side enforcement, not just hiding the UI control -- a question
  // that is required under the project's current answers can never be
  // satisfied via NOT_APPLICABLE (see src/lib/questionnaire/readiness.ts),
  // so silently accepting one here would leave a stored answer that looks
  // valid but readiness will never count, and would be the exact
  // unrestricted-bypass path this is meant to close if that check were
  // ever loosened.
  if (status === "NOT_APPLICABLE" && isRequired(question, loaded.ctx)) {
    return { error: "This question is required and cannot be marked not applicable." }
  }

  const { error } = await supabase.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: questionKey,
    p_questionnaire_version: questionnaireVersion,
    p_status: status,
    p_value: null,
    p_next_readiness_status: nextReadinessStatus(loaded.ctx),
  })

  if (error) {
    return { error: ruleErrorMessage(error, "Could not update this answer.") }
  }

  revalidatePath(`/projects/${projectId}/questionnaire`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return { error: null }
}
