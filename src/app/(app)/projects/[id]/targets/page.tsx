import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { TARGET_METRIC_LABELS, type TargetMetric } from "@/lib/domain/enums"
import { TargetForm } from "@/app/(app)/projects/[id]/targets/target-form"
import { ActualForm } from "@/app/(app)/projects/[id]/targets/actual-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function TargetsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name")
    .eq("id", id)
    .maybeSingle()

  if (!project) {
    notFound()
  }

  const { data: targets } = await supabase
    .from("project_targets")
    .select("*")
    .eq("project_id", id)
    .order("period_start", { ascending: false })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Targets &amp; progress</h1>
        <p className="text-sm text-muted-foreground">{project.project_name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a target</CardTitle>
        </CardHeader>
        <CardContent>
          <TargetForm projectId={id} />
        </CardContent>
      </Card>

      {!targets || targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No targets set yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {targets.map((t) => {
            const hasActual = t.actual !== null
            const progressPercent =
              hasActual && t.target !== 0
                ? Math.round(((t.actual as number) / t.target) * 100)
                : null
            return (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {TARGET_METRIC_LABELS[t.metric as TargetMetric]}
                      </span>
                      <Badge variant="outline">
                        {t.period_start} to {t.period_end}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Target: {t.target} {t.unit}
                      {t.baseline !== null ? ` · Baseline: ${t.baseline}` : ""}
                      {" · Actual: "}
                      {hasActual ? `${t.actual} ${t.unit}` : "UNKNOWN"}
                      {progressPercent !== null ? ` (${progressPercent}%)` : ""}
                    </p>
                  </div>
                  <ActualForm
                    targetId={t.id}
                    projectId={id}
                    currentActual={t.actual}
                  />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
