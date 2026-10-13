import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { updateProjectAction } from "@/app/(app)/projects/actions"
import { ProjectForm } from "@/app/(app)/projects/project-form"
import { LifecycleControls } from "@/app/(app)/projects/[id]/lifecycle-controls"
import { deletionEligibility, PROJECT_LIFECYCLE_TRANSITIONS } from "@/lib/domain/project"
import { getTimezoneOptions } from "@/lib/domain/timezones"
import type {
  ProjectLifecycleStatus,
  ProjectType,
} from "@/lib/domain/enums"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (!project) {
    notFound()
  }

  const { data: client } = await supabase
    .from("client_businesses")
    .select("display_name, status")
    .eq("id", project.client_business_id)
    .single()

  const { data: lifecycleEvents } = await supabase
    .from("lifecycle_events")
    .select("id, event_type, from_status, to_status, reason, created_at")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })

  const lifecycle = project.lifecycle_status as ProjectLifecycleStatus
  const clientArchived = client?.status !== "ACTIVE"
  let deletion: { eligibleOn: string; eligibleNow: boolean; retained: string[] } | null = null
  if (lifecycle === "ARCHIVED" && project.archived_at) {
    const { data: retained } = await supabase.rpc("project_retained_history", { p_project_id: id })
    deletion = { ...deletionEligibility(project.archived_at), retained: retained ?? [] }
  }
  const readOnly = lifecycle === "ARCHIVED" || clientArchived

  const timezones = getTimezoneOptions()
  const updateAction = updateProjectAction.bind(null, id)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{project.project_name}</h1>
        <div className="flex gap-2">
          <Badge variant={lifecycle === "ARCHIVED" ? "secondary" : "outline"} data-testid="lifecycle-status">
            {lifecycle}
          </Badge>
          <Badge variant="outline">{project.readiness_status}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["Questionnaire", "questionnaire"],
          ["Readiness", "readiness"],
          ["Financials", "financials"],
          ["Targets", "targets"],
          ["Evidence", "evidence"],
          ["Creatives", "creatives"],
          ["Reports", "reports"],
          ["Share links", "share-links"],
        ].map(([label, slug]) => (
          <Button key={slug} asChild variant="outline" size="sm">
            <Link href={`/projects/${id}/${slug}`}>{label}</Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LifecycleControls
            projectId={id}
            projectName={project.project_name}
            status={lifecycle}
            allowedTargets={lifecycle === "ARCHIVED" ? [] : PROJECT_LIFECYCLE_TRANSITIONS[lifecycle]}
            clientArchived={clientArchived}
            deletion={deletion}
          />
          {lifecycleEvents && lifecycleEvents.length > 0 ? (
            <div className="flex flex-col divide-y border-t pt-2 text-sm">
              {lifecycleEvents.map((e) => (
                <div key={e.id} className="flex flex-col gap-0.5 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {e.from_status} &rarr; {e.to_status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  {e.reason ? <span className="text-muted-foreground">&ldquo;{e.reason}&rdquo;</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          {readOnly ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Read-only while {lifecycle === "ARCHIVED" ? "the project" : "its client/business"} is archived.
            </p>
          ) : null}
          <ProjectForm
            action={updateAction}
            clients={[]}
            lockedClientName={client?.display_name ?? ""}
            timezones={timezones}
            submitLabel="Save changes"
            defaultValues={{
              clientBusinessId: project.client_business_id,
              projectName: project.project_name,
              // Safe: guaranteed by the projects CHECK constraints, which
              // the hand-generated Database type can't see.
              projectType: project.project_type as ProjectType,
              customTypeLabel: project.custom_type_label ?? "",
              defaultCurrency: project.default_currency,
              exportLanguage: project.export_language,
              timezone: project.timezone,
              startDate: project.start_date ?? "",
              targetCompletionDate: project.target_completion_date ?? "",
              shortDescription: project.short_description ?? "",
              internalNotes: project.internal_notes ?? "",
              tags: project.tags?.join(", ") ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
