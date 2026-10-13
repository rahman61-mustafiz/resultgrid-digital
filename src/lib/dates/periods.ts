/**
 * Dashboard reporting periods (BUILD_READINESS_QUESTIONNAIRE.md I02, M07,
 * E14.Q07): week, month, quarter, year and a custom range, each with the
 * period before it for comparison. Everything is a calendar date
 * (YYYY-MM-DD, both ends inclusive) in the workspace timezone (B08); "today"
 * is computed in that timezone, never the server's. Weeks run Monday to
 * Sunday (ISO 8601).
 *
 * Pure: `now` and the timezone are passed in.
 */

export const DASHBOARD_PERIODS = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "custom",
] as const
export type DashboardPeriodKey = (typeof DASHBOARD_PERIODS)[number]

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriodKey, string> = {
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  this_year: "This year",
  custom: "Custom range",
}

export function isDashboardPeriodKey(value: string | undefined | null): value is DashboardPeriodKey {
  return !!value && (DASHBOARD_PERIODS as readonly string[]).includes(value)
}

export type DateRange = { start: string; end: string }

export type ResolvedPeriod = {
  key: DashboardPeriodKey
  label: string
  current: DateRange
  previous: DateRange
  /** Days of the current period elapsed by today (it may still be in progress). */
  elapsedDays: number
  totalDays: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string | undefined | null): value is string {
  if (!value || !DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Today's date in the given IANA timezone. */
export function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** Inclusive number of days in [start, end]. */
export function daysInRange(range: DateRange): number {
  return Math.round((toUtc(range.end).getTime() - toUtc(range.start).getTime()) / 86_400_000) + 1
}

function monthRange(year: number, month: number): DateRange {
  // month may be out of 0..11; Date.UTC normalizes it.
  return {
    start: fromUtc(new Date(Date.UTC(year, month, 1))),
    end: fromUtc(new Date(Date.UTC(year, month + 1, 0))),
  }
}

function weekStart(date: string): string {
  const day = toUtc(date).getUTCDay() // 0 = Sunday
  return addDays(date, -((day + 6) % 7))
}

/** The most days a custom range may span (keeps queries bounded). */
export const MAX_CUSTOM_DAYS = 3660

export type PeriodInput = {
  key: DashboardPeriodKey
  from?: string | null
  to?: string | null
}

/**
 * Resolves a period in the workspace timezone. A custom range needs valid
 * `from` <= `to`, at most MAX_CUSTOM_DAYS long; its previous period is the
 * same number of days immediately before it. Returns an error message for
 * an invalid custom range instead of guessing.
 */
export function resolvePeriod(
  input: PeriodInput,
  timeZone: string,
  now: Date
): { ok: true; period: ResolvedPeriod } | { ok: false; error: string } {
  const today = todayIn(timeZone, now)
  const [y, m] = today.split("-").map(Number)
  const year = y
  const month = m - 1

  let current: DateRange
  let previous: DateRange
  switch (input.key) {
    case "this_week":
    case "last_week": {
      const thisStart = weekStart(today)
      const start = input.key === "this_week" ? thisStart : addDays(thisStart, -7)
      current = { start, end: addDays(start, 6) }
      previous = { start: addDays(start, -7), end: addDays(start, -1) }
      break
    }
    case "this_month":
    case "last_month": {
      const offset = input.key === "this_month" ? 0 : -1
      current = monthRange(year, month + offset)
      previous = monthRange(year, month + offset - 1)
      break
    }
    case "this_quarter":
    case "last_quarter": {
      const q = Math.floor(month / 3) * 3 + (input.key === "this_quarter" ? 0 : -3)
      current = { start: monthRange(year, q).start, end: monthRange(year, q + 2).end }
      previous = { start: monthRange(year, q - 3).start, end: monthRange(year, q - 1).end }
      break
    }
    case "this_year":
      current = { start: `${year}-01-01`, end: `${year}-12-31` }
      previous = { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` }
      break
    case "custom": {
      if (!isIsoDate(input.from) || !isIsoDate(input.to)) {
        return { ok: false, error: "Choose a start and an end date for the custom range." }
      }
      if (input.from > input.to) {
        return { ok: false, error: "The custom range must start on or before its end date." }
      }
      current = { start: input.from, end: input.to }
      const days = daysInRange(current)
      if (days > MAX_CUSTOM_DAYS) {
        return { ok: false, error: "A custom range can cover at most 10 years." }
      }
      previous = { start: addDays(current.start, -days), end: addDays(current.start, -1) }
      break
    }
  }

  const totalDays = daysInRange(current)
  const elapsedDays =
    today < current.start ? 0 : today > current.end ? totalDays : daysInRange({ start: current.start, end: today })
  return {
    ok: true,
    period: { key: input.key, label: DASHBOARD_PERIOD_LABELS[input.key], current, previous, elapsedDays, totalDays },
  }
}

/** Where a dated record [start, end] falls relative to a range. */
export function placement(record: DateRange, range: DateRange): "inside" | "spans" | "outside" {
  if (record.end < range.start || record.start > range.end) return "outside"
  if (record.start >= range.start && record.end <= range.end) return "inside"
  return "spans"
}
