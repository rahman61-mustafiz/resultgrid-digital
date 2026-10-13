import { DASHBOARD_PERIOD_LABELS, placement, resolvePeriod } from "@/lib/dates/periods"
import { periodsOverlap, REPORT_PERIOD_LABELS, REPORT_PERIODS, resolveReportPeriodRange } from "@/lib/reports/period"

/**
 * Client report calculation rules, versioned per share link
 * (supabase/migrations/20261010110000_report_rules_version.sql) so a link a
 * client already has never changes its numbers silently.
 *
 * v1 -- links created before 10 October 2026: periods all/this month/last
 *       month/this quarter/this year, dates from the server's clock, and a
 *       record overlapping the period counted in full.
 * v2 -- new links and the Owner's preview: the same rules as the dashboard
 *       (src/lib/finance/dashboard.ts). Dates in the project's timezone;
 *       weeks (Monday to Sunday), months, quarters and the year; a record
 *       counts only when its own dates fall inside the period, and one that
 *       straddles the edge is left out and noted.
 *
 * Pure: `now` is passed in.
 */

export type ReportRulesVersion = 1 | 2

export const REPORT_RULES_LABEL: Record<ReportRulesVersion, string> = {
  1: "Calculation rules v1: a record overlapping the period is counted in full.",
  2: "Calculation rules v2: only records dated entirely inside the period are counted.",
}

export const REPORT_PERIODS_V2 = [
  "all",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
] as const

export function reportPeriodOptions(rules: ReportRulesVersion): { key: string; label: string }[] {
  return rules === 1
    ? REPORT_PERIODS.map((k) => ({ key: k, label: REPORT_PERIOD_LABELS[k] }))
    : REPORT_PERIODS_V2.map((k) => ({ key: k, label: k === "all" ? "All time" : DASHBOARD_PERIOD_LABELS[k] }))
}

/** A valid period key for these rules, or "all". */
export function parseReportPeriod(rules: ReportRulesVersion, value: string | undefined | null): string {
  return reportPeriodOptions(rules).some((o) => o.key === value) ? value! : "all"
}

type Dated = { period_start: string; period_end: string }

export type ReportSelection<F extends Dated, T extends Dated> = {
  periodLabel: string
  financials: F[]
  /** Records left out because they straddle the period edge (v2 only). */
  spanning: number
  targets: T[]
}

export function selectReportRows<F extends Dated, T extends Dated>(
  input: { financials: F[]; targets: T[]; timeZone: string },
  periodKey: string,
  rules: ReportRulesVersion,
  now: Date
): ReportSelection<F, T> {
  const key = parseReportPeriod(rules, periodKey)
  if (key === "all") {
    return { periodLabel: "All time", financials: input.financials, spanning: 0, targets: input.targets }
  }

  if (rules === 1) {
    const range = resolveReportPeriodRange(key as (typeof REPORT_PERIODS)[number], now)!
    const overlaps = (r: Dated) => periodsOverlap(r.period_start, r.period_end, range.start, range.end)
    return {
      periodLabel: `${range.start} to ${range.end}`,
      financials: input.financials.filter(overlaps),
      spanning: 0,
      targets: input.targets.filter(overlaps),
    }
  }

  const resolved = resolvePeriod({ key: key as Exclude<(typeof REPORT_PERIODS_V2)[number], "all"> }, input.timeZone, now)
  if (!resolved.ok) throw new Error(resolved.error)
  const range = resolved.period.current
  const where = (r: Dated) => placement({ start: r.period_start, end: r.period_end }, range)
  return {
    periodLabel: `${range.start} to ${range.end}`,
    financials: input.financials.filter((r) => where(r) === "inside"),
    spanning: input.financials.filter((r) => where(r) === "spans").length,
    targets: input.targets.filter((t) => where(t) !== "outside"),
  }
}
