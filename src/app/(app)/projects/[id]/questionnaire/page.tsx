import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { QUESTIONS, SECTION_ORDER, SECTION_TITLES } from "@/lib/questionnaire/v1"
import {
  answerIssues,
  buildContext,
  conditionSources,
  isAnswered,
  isApplicable,
  isRequired,
  type AnswerRecord,
} from "@/lib/questionnaire/engine"
import type { StructuredValue } from "@/lib/questionnaire/types"
import { QuestionField } from "@/app/(app)/projects/[id]/questionnaire/question-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name, project_type")
    .eq("id", id)
    .maybeSingle()

  if (!project) {
    notFound()
  }

  const { data: answers } = await supabase
    .from("project_answers")
    .select("question_key, status, value")
    .eq("project_id", id)

  const ctx = buildContext(project.project_type, (answers ?? []) as AnswerRecord[])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Questionnaire</h1>
          <p className="text-sm text-muted-foreground">{project.project_name}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/projects/${id}/readiness`}>Readiness review</Link>
        </Button>
      </div>

      {SECTION_ORDER.map((section) => {
        const questions = QUESTIONS.filter((q) => q.section === section)
        if (questions.length === 0) return null
        return (
          <Card key={section} id={section}>
            <CardHeader>
              <CardTitle className="text-base">
                {section} &mdash; {SECTION_TITLES[section]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {questions.map((question) => {
                if (!isApplicable(question, ctx)) {
                  return (
                    <p
                      key={question.key}
                      id={`q-${question.key}`}
                      className="border-b py-3 text-sm text-muted-foreground last:border-b-0"
                      data-testid="not-applicable-question"
                    >
                      <span className="font-medium">[{question.key}]</span> {question.question}{" "}
                      &mdash; doesn&apos;t apply, based on{" "}
                      {conditionSources(question.showWhen).join(", ")}.
                    </p>
                  )
                }
                const answer = ctx.answers.get(question.key)
                const value = answer?.value
                const initialValue =
                  typeof value === "string"
                    ? value
                    : value && typeof value === "object" && !Array.isArray(value)
                      ? (value as StructuredValue)
                      : null
                return (
                  <QuestionField
                    key={question.key}
                    projectId={id}
                    question={question}
                    initialValue={initialValue}
                    initialStatus={answer?.status ?? "UNANSWERED"}
                    initialIssues={isAnswered(answer) ? answerIssues(question, answer!.value, ctx) : []}
                    required={isRequired(question, ctx)}
                  />
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
