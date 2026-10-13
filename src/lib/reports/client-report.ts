import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { computeClientProfit, type FinancialRecordRow } from "@/lib/finance/profit"
import { TARGET_METRIC_LABELS, type TargetMetric } from "@/lib/domain/enums"
import { REPORT_RULES_LABEL, parseReportPeriod, selectReportRows, type ReportRulesVersion } from "@/lib/reports/report-rules"

export type ClientReport = {
  projectName: string
  clientName: string
  currency: string
  readinessStatus: string
  periodKey: string
  periodLabel: string
  rules: ReportRulesVersion
  rulesLabel: string
  /** Records left out because they straddle the period edge (rules v2). */
  spanning: number
  profit: ReturnType<typeof computeClientProfit>
  targets: {
    metric: string
    unit: string
    target: number
    actual: number | null
    periodStart: string
    periodEnd: string
  }[]
  generatedAt: string
}

export type ClientReportResult =
  | { ok: true; report: ClientReport }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "NOT_APPROVED"; readinessStatus: string }

type ReportSnapshot = {
  project_name: string
  default_currency: string
  timezone: string | null
  readiness_status: string
  client_name: string | null
  latest_export_version: number | null
  financials: (FinancialRecordRow & { period_start: string; period_end: string })[]
  targets: {
    metric: string
    unit: string
    target: number
    actual: number | null
    period_start: string
    period_end: string
  }[]
}

/**
 * Builds the data a client is allowed to see for one project: the CLIENT
 * profit view only (never ResultGrid Digital's internal margin/fee
 * breakdown -- see BUILD_READINESS_QUESTIONNAIRE.md E14.Q14), and
 * target-vs-actual progress, for a given reporting period. Internal
 * notes, other clients, and personal/payment identifiers are never
 * touched here at all.
 *
 * Gated on the project being APPROVED. Every write that could change what
 * this returns invalidates APPROVED atomically (supabase/migrations/
 * 20260922*.sql, 20260923*.sql), and all the data comes from ONE database
 * statement (get_client_report_snapshot, 20260923140000), so status,
 * financials and targets are always from the same snapshot -- an edit plus
 * re-approval can't land between separate reads, because there are none.
 *
 * Uses the admin client deliberately: both the Owner-side report preview
 * and the public share-link viewer (which has no authenticated session)
 * call this the same way.
 */
export async function buildClientReport(
  projectId: string,
  periodParam: string | undefined,
  rules: ReportRulesVersion
): Promise<ClientReportResult> {
  const admin = createAdminClient()

  const { data, error } = await admin.rpc("get_client_report_snapshot", {
    p_project_id: projectId,
  })
  if (error) throw new Error(`Could not load client report: ${error.message}`)
  if (!data) return { ok: false, reason: "NOT_FOUND" }

  const snapshot = data as unknown as ReportSnapshot

  if (snapshot.readiness_status !== "APPROVED") {
    return { ok: false, reason: "NOT_APPROVED", readinessStatus: snapshot.readiness_status }
  }

  const periodKey = parseReportPeriod(rules, periodParam)
  const selected = selectReportRows(
    { financials: snapshot.financials, targets: snapshot.targets, timeZone: snapshot.timezone || "Asia/Dhaka" },
    periodKey,
    rules,
    new Date()
  )
  const profit = computeClientProfit(selected.financials)

  return {
    ok: true,
    report: {
      projectName: snapshot.project_name,
      clientName: snapshot.client_name ?? "Client",
      currency: snapshot.default_currency,
      readinessStatus: snapshot.readiness_status,
      periodKey,
      periodLabel: selected.periodLabel,
      rules,
      rulesLabel: REPORT_RULES_LABEL[rules],
      spanning: selected.spanning,
      profit,
      // Every target in the period: no display cap, so none is dropped silently.
      targets: selected.targets.map((t) => ({
        metric: TARGET_METRIC_LABELS[t.metric as TargetMetric] ?? t.metric,
        unit: t.unit,
        target: t.target,
        actual: t.actual,
        periodStart: t.period_start,
        periodEnd: t.period_end,
      })),
      generatedAt: new Date().toISOString(),
    },
  }
}
