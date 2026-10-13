import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { computeReadiness, type AnswerRecord } from "@/lib/questionnaire/readiness"
import { ReadinessActions } from "@/app/(app)/projects/[id]/readiness/readiness-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function ReadinessPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name, project_type, readiness_status")
    .eq("id", id)
    .maybeSingle()

  if (!project) {
    notFound()
  }

  const { data: answers } = await supabase
    .from("project_answers")
    .select("question_key, status, value")
    .eq("project_id", id)

  const readiness = computeReadiness((answers ?? []) as AnswerRecord[], project.project_type)

  const { data: exports } = await supabase
    .from("project_exports")
    .select("id, version, generated_at")
    .eq("project_id", id)
    .order("version", { ascending: false })

  // H09: archived exports are kept and downloadable, just listed apart.
  const { data: archiveEvents } = exports?.length
    ? await supabase
        .from("project_export_archive_events")
        .select("export_id, event_type, seq")
        .in("export_id", exports.map((e) => e.id))
        .order("seq")
    : { data: [] }
  const archivedIds = new Set<string>()
  for (const e of archiveEvents ?? []) {
    if (e.event_type === "ARCHIVED") archivedIds.add(e.export_id)
    else archivedIds.delete(e.export_id)
  }
  const activeExports = (exports ?? []).filter((e) => !archivedIds.has(e.id))
  const archivedExports = (exports ?? []).filter((e) => archivedIds.has(e.id))

  const { data: approvalEvents } = await supabase
    .from("project_approval_events")
    .select("id, event_type, from_status, to_status, export_version, reason, actor_id, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Readiness review</h1>
          <p className="text-sm text-muted-foreground">{project.project_name}</p>
        </div>
        <Badge variant={readiness.isComplete ? "default" : "outline"}>
          {project.readiness_status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {readiness.completed} / {readiness.totalRequired} required questions
            complete ({readiness.completionPercent}%)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {readiness.problems.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Missing or invalid answers:</p>
              <ul className="flex flex-col gap-2">
                {readiness.problems.map(({ question: q, issues }) => (
                  <li key={q.key} className="text-sm">
                    <Link
                      href={`/projects/${id}/questionnaire#q-${q.key}`}
                      className="underline"
                    >
                      [{q.key}] {q.question}
                    </Link>
                    <ul className="ml-4 list-disc text-muted-foreground">
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              All required questions are answered and valid.
            </p>
          )}
          {readiness.notApplicable.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {readiness.notApplicable.length} question(s) don&apos;t apply to this project
              because of earlier answers or the project type.
            </p>
          ) : null}

          <ReadinessActions
            projectId={id}
            readinessStatus={project.readiness_status}
            isComplete={readiness.isComplete}
            hasExport={(exports?.length ?? 0) > 0}
          />
        </CardContent>
      </Card>

      {exports && exports.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Exports</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {activeExports.map((e) => (
              <div key={e.version} className="flex items-center justify-between py-2 text-sm">
                <span>
                  v{String(e.version).padStart(2, "0")} &middot; {new Date(e.generated_at).toLocaleString()}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/projects/${id}/readiness/exports/${e.version}`}>View / download</Link>
                </Button>
              </div>
            ))}
            {activeExports.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">All exports are archived.</p>
            ) : null}
            {archivedExports.length > 0 ? (
              <details className="pt-2" data-testid="archived-exports">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Archived exports ({archivedExports.length})
                </summary>
                <div className="flex flex-col divide-y">
                {archivedExports.map((e) => (
                  <div key={e.version} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      v{String(e.version).padStart(2, "0")} &middot; {new Date(e.generated_at).toLocaleString()}
                    </span>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/projects/${id}/readiness/exports/${e.version}`}>View / download</Link>
                    </Button>
                  </div>
                ))}
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {approvalEvents && approvalEvents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Approval history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {approvalEvents.map((e) => (
              <div key={e.id} className="flex flex-col gap-0.5 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {APPROVAL_EVENT_LABELS[e.event_type] ?? e.event_type}
                    {e.export_version
                      ? ` (v${String(e.export_version).padStart(2, "0")})`
                      : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {e.actor_id ? "Owner" : "System"}
                  {e.from_status && e.to_status && e.from_status !== e.to_status
                    ? ` · ${e.from_status} → ${e.to_status}`
                    : ""}
                </p>
                {e.reason ? (
                  <p className="text-xs text-muted-foreground italic">
                    &ldquo;{e.reason}&rdquo;
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

const APPROVAL_EVENT_LABELS: Record<string, string> = {
  SUBMITTED_FOR_REVIEW: "Marked ready for review",
  APPROVED: "Approved",
  INVALIDATED: "Approval invalidated",
  EXPORTED: "Export generated",
}
