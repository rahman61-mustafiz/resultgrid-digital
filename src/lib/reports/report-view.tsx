import type { ClientReport } from "@/lib/reports/client-report"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ClientReportView({ report }: { report: ClientReport }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{report.projectName}</h1>
        <p className="text-sm text-muted-foreground">{report.clientName}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Badge variant="outline">{report.readinessStatus}</Badge>
          <span className="text-sm text-muted-foreground">
            Period: {report.periodLabel}
          </span>
        </CardContent>
        <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="report-rules">
          <span>{report.rulesLabel}</span>
          {report.spanning > 0 ? (
            <span data-testid="report-spanning">
              {report.spanning} record(s) cover dates both inside and outside this period and are not included.
            </span>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profit summary (marketing-attributed)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {report.profit.status === "INCOMPLETE" ? (
            <p className="text-sm text-muted-foreground">
              Not enough recorded, evidenced, marketing-attributed data yet to
              calculate this figure for this period.
            </p>
          ) : (
            <p className="text-lg font-medium">
              {report.currency} {report.profit.amount.toLocaleString()}
            </p>
          )}
          {report.profit.caveats.map((c, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {c}
            </p>
          ))}
        </CardContent>
      </Card>

      {report.targets.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Targets &amp; progress</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {report.targets.map((t, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {t.metric} ({t.periodStart} to {t.periodEnd})
                </span>
                <span className="text-muted-foreground">
                  Target {t.target} {t.unit} &middot; Actual{" "}
                  {t.actual === null ? "UNKNOWN" : `${t.actual} ${t.unit}`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        Generated {new Date(report.generatedAt).toLocaleString()} for {report.periodLabel.toLowerCase()}
        &middot; figures reflect the approved state as of this date; not a guarantee
        of future results.
      </p>
    </div>
  )
}
