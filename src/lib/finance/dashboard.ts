import { computeClientProfit, computeResultGridProfit, type ProfitResult } from "@/lib/finance/profit"
import { placement, type DateRange } from "@/lib/dates/periods"
import { FINANCIAL_RECORD_TYPES, type FinancialRecordType, type ValueStatus } from "@/lib/domain/enums"

/**
 * The Owner dashboard's money figures for one period and the period before
 * it (BUILD_READINESS_QUESTIONNAIRE.md I02, M12, M13). Truthfulness rules:
 *
 * - A record counts in a period only when its own dates fall entirely
 *   inside it. A record that straddles the boundary (e.g. a quarterly fee
 *   viewed by month) is NOT prorated or counted whole; it is left out and
 *   reported as a warning.
 * - Totals are per currency, never summed across currencies (M06).
 * - "No records" is not zero: a category with no data shows as such, and a
 *   comparison against a period with no data has no percentage.
 * - CONFIRMED and ESTIMATED add, REFUNDED subtracts, PENDING and DISPUTED
 *   are left out and counted (same rule as src/lib/finance/profit.ts);
 *   estimated amounts are counted and flagged.
 * - Profit uses the existing formulas per project and is INCOMPLETE, never
 *   a number, when required inputs are missing.
 *
 * Pure: the caller loads the rows.
 */

export type DashboardRecord = {
  project_id: string
  currency: string
  record_type: FinancialRecordType
  amount: number
  value_status: ValueStatus
  attributed_to_marketing: boolean
  evidence_status: string
  period_start: string
  period_end: string
}

export type CurrencyTotals = Record<string, number>

export type CategoryPeriod = {
  /** Per-currency total of counted records; empty when there are none. */
  totals: CurrencyTotals
  counted: number
  estimated: number
  pending: number
  disputed: number
}

export type PeriodSummary = {
  categories: Record<FinancialRecordType, CategoryPeriod>
  /** Records in the period (any status). */
  inPeriod: number
  /** Records overlapping the period without fitting inside it: left out. */
  spanning: number
  /** Counted records whose evidence is UNVERIFIED. */
  unverified: number
}

function emptyCategory(): CategoryPeriod {
  return { totals: {}, counted: 0, estimated: 0, pending: 0, disputed: 0 }
}

export function summarizePeriod(records: DashboardRecord[], range: DateRange): PeriodSummary {
  const categories = Object.fromEntries(FINANCIAL_RECORD_TYPES.map((t) => [t, emptyCategory()])) as Record<
    FinancialRecordType,
    CategoryPeriod
  >
  let inPeriod = 0
  let spanning = 0
  let unverified = 0

  for (const r of records) {
    const where = placement({ start: r.period_start, end: r.period_end }, range)
    if (where === "outside") continue
    if (where === "spans") {
      spanning += 1
      continue
    }
    inPeriod += 1
    const c = categories[r.record_type]
    if (!c) continue
    switch (r.value_status) {
      case "PENDING":
        c.pending += 1
        continue
      case "DISPUTED":
        c.disputed += 1
        continue
      case "ESTIMATED":
        c.estimated += 1
        break
    }
    const signed = r.value_status === "REFUNDED" ? -r.amount : r.amount
    c.totals[r.currency] = (c.totals[r.currency] ?? 0) + signed
    c.counted += 1
    if (r.evidence_status === "UNVERIFIED") unverified += 1
  }
  return { categories, inPeriod, spanning, unverified }
}

export type Change =
  | { kind: "change"; current: number; previous: number; delta: number; percent: number | null }
  | { kind: "no-previous"; current: number }
  | { kind: "no-current"; previous: number }

/**
 * Per-currency comparison of one category. A currency with data in only
 * one of the two periods is reported as such, never as +100% or -100%.
 * `percent` is null when the previous total is exactly 0.
 */
export function compareTotals(current: CategoryPeriod, previous: CategoryPeriod): Record<string, Change> {
  const out: Record<string, Change> = {}
  const currencies = new Set([...Object.keys(current.totals), ...Object.keys(previous.totals)])
  for (const cur of [...currencies].sort()) {
    const a = current.totals[cur]
    const b = previous.totals[cur]
    if (a === undefined) out[cur] = { kind: "no-current", previous: b! }
    else if (b === undefined) out[cur] = { kind: "no-previous", current: a }
    else out[cur] = { kind: "change", current: a, previous: b, delta: a - b, percent: b === 0 ? null : ((a - b) / Math.abs(b)) * 100 }
  }
  return out
}

export type ProjectProfit = {
  projectId: string
  currency: string
  resultGrid: ProfitResult
  client: ProfitResult
  spanning: number
}

/** Both profit views per project, from the records inside the period only. */
export function profitByProject(
  records: DashboardRecord[],
  projects: { id: string; currency: string }[],
  range: DateRange
): ProjectProfit[] {
  return projects.map((p) => {
    const own = records.filter((r) => r.project_id === p.id)
    const inside = own.filter((r) => placement({ start: r.period_start, end: r.period_end }, range) === "inside")
    const spanning = own.filter((r) => placement({ start: r.period_start, end: r.period_end }, range) === "spans").length
    return {
      projectId: p.id,
      currency: p.currency,
      resultGrid: computeResultGridProfit(inside),
      client: computeClientProfit(inside),
      spanning,
    }
  })
}

export type TargetRow = {
  project_id: string
  metric: string
  unit: string
  target: number
  actual: number | null
  baseline: number | null
  period_start: string
  period_end: string
}

export type TargetProgress = TargetRow & {
  /**
   * actual / target as a percentage; null when no actual is recorded (not
   * 0%) or the target is 0. No "met" judgment: for some metrics (cost per
   * acquisition, keyword ranking) lower is better, and targets don't record
   * which way is good.
   */
  percent: number | null
}

/** Targets whose own period overlaps the selected one. */
export function targetProgress(targets: TargetRow[], range: DateRange): TargetProgress[] {
  return targets
    .filter((t) => placement({ start: t.period_start, end: t.period_end }, range) !== "outside")
    .map((t) => ({ ...t, percent: t.actual === null || t.target === 0 ? null : (t.actual / t.target) * 100 }))
}
