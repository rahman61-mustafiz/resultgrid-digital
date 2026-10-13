import Link from "next/link"

import { buildClientReport } from "@/lib/reports/client-report"
import { ClientReportView } from "@/lib/reports/report-view"
import { PeriodSelector } from "@/lib/reports/period-selector"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string; rules?: string }>
}) {
  const { id } = await params
  const { period, rules: rulesParam } = await searchParams
  const rules = rulesParam === "1" ? 1 : 2
  const result = await buildClientReport(id, period, rules)

  // Which rules the project's active links use (a link never changes rules).
  const supabase = await createClient()
  const { data: activeLinks } = await supabase
    .from("client_share_links")
    .select("report_rules_version")
    .eq("project_id", id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
  const legacyLinks = (activeLinks ?? []).filter((l) => l.report_rules_version === 1).length

  const header = (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Preview of what a client sees via an approved share link.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${id}/share-links`}>Manage share links</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="preview-rules">
        <span>
          Previewing calculation rules v{rules}
          {rules === 2 ? " (used by new share links)" : " (used by share links created before 10 October 2026)"}.{" "}
          <Link href={`/projects/${id}/reports${rules === 2 ? "?rules=1" : ""}`} className="underline">
            {rules === 2 ? "Preview v1 instead" : "Preview v2 instead"}
          </Link>
        </span>
        {legacyLinks > 0 ? (
          <span>
            {legacyLinks} active share link{legacyLinks === 1 ? " uses" : "s use"} v1 and keeps it; create a new link to give the client
            v2.
          </span>
        ) : null}
      </div>
      <PeriodSelector
        basePath={`/projects/${id}/reports`}
        activePeriod={result.ok ? result.report.periodKey : "all"}
        rules={rules}
        extraQuery={rules === 1 ? "rules=1" : ""}
      />
    </div>
  )

  if (!result.ok) {
    if (result.reason === "NOT_FOUND") {
      return (
        <div className="flex flex-col gap-4">
          {header}
          <p className="mx-auto text-sm text-muted-foreground">Project not found.</p>
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Not approved yet</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              This report only reflects an approved, stable snapshot -- current
              status is <strong>{result.readinessStatus}</strong>. Approve the
              project on its readiness page before previewing or sharing this
              report.
            </p>
            <Button asChild variant="outline" size="sm" className="self-start">
              <Link href={`/projects/${id}/readiness`}>Go to readiness</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <ClientReportView report={result.report} />
    </div>
  )
}
