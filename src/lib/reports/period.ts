export const REPORT_PERIODS = [
  "all",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
] as const
export type ReportPeriodKey = (typeof REPORT_PERIODS)[number]

export const REPORT_PERIOD_LABELS: Record<ReportPeriodKey, string> = {
  all: "All time",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
}

export function isReportPeriodKey(value: string | undefined | null): value is ReportPeriodKey {
  return !!value && (REPORT_PERIODS as readonly string[]).includes(value)
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Resolves a period key to a concrete [start, end] date range (inclusive,
 * YYYY-MM-DD), or null for "all" (no filter). `now` is passed in rather
 * than read internally so this stays a pure function -- see
 * BUILD_READINESS_QUESTIONNAIRE.md E14.Q07 ("which time periods must the
 * dashboard and reports support").
 */
export function resolveReportPeriodRange(
  key: ReportPeriodKey,
  now: Date
): { start: string; end: string } | null {
  const year = now.getFullYear()
  const month = now.getMonth()

  switch (key) {
    case "all":
      return null
    case "this_month":
      return {
        start: toDateString(new Date(year, month, 1)),
        end: toDateString(new Date(year, month + 1, 0)),
      }
    case "last_month":
      return {
        start: toDateString(new Date(year, month - 1, 1)),
        end: toDateString(new Date(year, month, 0)),
      }
    case "this_quarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3
      return {
        start: toDateString(new Date(year, quarterStartMonth, 1)),
        end: toDateString(new Date(year, quarterStartMonth + 3, 0)),
      }
    }
    case "this_year":
      return { start: `${year}-01-01`, end: `${year}-12-31` }
  }
}

/** True when [aStart, aEnd] overlaps [bStart, bEnd] at all (both inclusive). */
export function periodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aEnd >= bStart && aStart <= bEnd
}
