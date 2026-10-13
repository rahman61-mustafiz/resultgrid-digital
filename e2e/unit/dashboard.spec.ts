import { expect, test } from "@playwright/test"

import { addDays, placement, resolvePeriod, todayIn } from "@/lib/dates/periods"
import { compareTotals, profitByProject, summarizePeriod, targetProgress, type DashboardRecord } from "@/lib/finance/dashboard"
import { searchAny, withParams } from "@/lib/list-query"

const TZ = "Asia/Dhaka"
// 2026-10-09 20:30 UTC is already Saturday 10 October in Dhaka (UTC+6).
const NOW = new Date("2026-10-09T20:30:00Z")

function period(key: Parameters<typeof resolvePeriod>[0]["key"], from?: string, to?: string) {
  const r = resolvePeriod({ key, from, to }, TZ, NOW)
  if (!r.ok) throw new Error(r.error)
  return r.period
}

test.describe("dashboard periods (I02, M07)", () => {
  test("today is the workspace's date, not the server's", () => {
    expect(todayIn(TZ, NOW)).toBe("2026-10-10")
    expect(todayIn("UTC", NOW)).toBe("2026-10-09")
  })

  test("weeks run Monday to Sunday; the previous week is the one before", () => {
    const w = period("this_week")
    expect(w.current).toEqual({ start: "2026-10-05", end: "2026-10-11" })
    expect(w.previous).toEqual({ start: "2026-09-28", end: "2026-10-04" })
    expect(w.elapsedDays).toBe(6)
    expect(period("last_week").current).toEqual({ start: "2026-09-28", end: "2026-10-04" })
  })

  test("months, quarters and years compare with the calendar period before", () => {
    expect(period("this_month").current).toEqual({ start: "2026-10-01", end: "2026-10-31" })
    expect(period("this_month").previous).toEqual({ start: "2026-09-01", end: "2026-09-30" })
    expect(period("last_month").previous).toEqual({ start: "2026-08-01", end: "2026-08-31" })
    expect(period("this_quarter").current).toEqual({ start: "2026-10-01", end: "2026-12-31" })
    expect(period("this_quarter").previous).toEqual({ start: "2026-07-01", end: "2026-09-30" })
    expect(period("last_quarter").previous).toEqual({ start: "2026-04-01", end: "2026-06-30" })
    expect(period("this_year").previous).toEqual({ start: "2025-01-01", end: "2025-12-31" })
    const jan = resolvePeriod({ key: "last_month" }, TZ, new Date("2026-01-15T00:00:00Z"))
    expect(jan.ok && jan.period.current).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    const q1 = resolvePeriod({ key: "this_quarter" }, TZ, new Date("2026-02-01T00:00:00Z"))
    expect(q1.ok && q1.period.previous).toEqual({ start: "2025-10-01", end: "2025-12-31" })
  })

  test("a custom range compares with the same number of days before it; bad input is refused", () => {
    const c = period("custom", "2026-03-10", "2026-03-19")
    expect(c.previous).toEqual({ start: "2026-02-28", end: "2026-03-09" })
    expect(resolvePeriod({ key: "custom", from: "2026-03-19", to: "2026-03-10" }, TZ, NOW).ok).toBe(false)
    expect(resolvePeriod({ key: "custom", from: "2026-02-30", to: "2026-03-10" }, TZ, NOW).ok).toBe(false)
    expect(resolvePeriod({ key: "custom", from: "", to: "2026-03-10" }, TZ, NOW).ok).toBe(false)
    expect(resolvePeriod({ key: "custom", from: "2000-01-01", to: "2026-03-10" }, TZ, NOW).ok).toBe(false)
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29")
  })

  test("a record is inside, straddling or outside a range", () => {
    const oct = { start: "2026-10-01", end: "2026-10-31" }
    expect(placement({ start: "2026-10-01", end: "2026-10-31" }, oct)).toBe("inside")
    expect(placement({ start: "2026-09-15", end: "2026-10-15" }, oct)).toBe("spans")
    expect(placement({ start: "2026-09-01", end: "2026-09-30" }, oct)).toBe("outside")
  })
})

const rec = (over: Partial<DashboardRecord>): DashboardRecord => ({
  project_id: "p1",
  currency: "BDT",
  record_type: "CLIENT_PAYMENT_RECEIVED",
  amount: 100,
  value_status: "CONFIRMED",
  attributed_to_marketing: false,
  evidence_status: "VERIFIED",
  period_start: "2026-10-05",
  period_end: "2026-10-05",
  ...over,
})
const OCT = { start: "2026-10-01", end: "2026-10-31" }
const SEP = { start: "2026-09-01", end: "2026-09-30" }

test.describe("dashboard figures stay truthful (M06, M12)", () => {
  test("statuses: confirmed and estimated add, refunds subtract, pending and disputed are left out and counted", () => {
    const s = summarizePeriod(
      [
        rec({ amount: 1000 }),
        rec({ amount: 200, value_status: "ESTIMATED", evidence_status: "UNVERIFIED" }),
        rec({ amount: 50, value_status: "REFUNDED" }),
        rec({ amount: 999, value_status: "PENDING" }),
        rec({ amount: 999, value_status: "DISPUTED" }),
      ],
      OCT
    )
    const c = s.categories.CLIENT_PAYMENT_RECEIVED
    expect(c.totals).toEqual({ BDT: 1150 })
    expect([c.counted, c.estimated, c.pending, c.disputed]).toEqual([3, 1, 1, 1])
    expect(s.unverified).toBe(1)
  })

  test("a record straddling the period edge is left out and reported, not split or counted whole", () => {
    const s = summarizePeriod([rec({ amount: 3000, period_start: "2026-09-15", period_end: "2026-10-15" }), rec({ amount: 10 })], OCT)
    expect(s.categories.CLIENT_PAYMENT_RECEIVED.totals).toEqual({ BDT: 10 })
    expect(s.spanning).toBe(1)
  })

  test("currencies are never added together", () => {
    const s = summarizePeriod([rec({ amount: 100 }), rec({ amount: 5, currency: "USD", project_id: "p2" })], OCT)
    expect(s.categories.CLIENT_PAYMENT_RECEIVED.totals).toEqual({ BDT: 100, USD: 5 })
  })

  test("no records is not zero, and a comparison with an empty period has no percentage", () => {
    const records = [rec({ amount: 300 }), rec({ amount: 200, period_start: "2026-09-10", period_end: "2026-09-10" }), rec({ amount: 7, currency: "USD", project_id: "p2" })]
    const now = summarizePeriod(records, OCT)
    const before = summarizePeriod(records, SEP)
    expect(now.categories.MARKETING_SPEND.totals).toEqual({})
    const ch = compareTotals(now.categories.CLIENT_PAYMENT_RECEIVED, before.categories.CLIENT_PAYMENT_RECEIVED)
    expect(ch.BDT).toEqual({ kind: "change", current: 300, previous: 200, delta: 100, percent: 50 })
    expect(ch.USD).toEqual({ kind: "no-previous", current: 7 })
    expect(compareTotals(now.categories.MARKETING_SPEND, before.categories.MARKETING_SPEND)).toEqual({})
  })

  test("profit per project uses only records inside the period and is INCOMPLETE without its inputs", () => {
    const records = [
      rec({ amount: 5000 }),
      rec({ record_type: "DIRECT_DELIVERY_COST", amount: 1000 }),
      rec({ amount: 9999, period_start: "2026-09-20", period_end: "2026-10-10" }),
      rec({ project_id: "p2", record_type: "MARKETING_SPEND", amount: 400 }),
    ]
    const [p1, p2] = profitByProject(records, [{ id: "p1", currency: "BDT" }, { id: "p2", currency: "BDT" }], OCT)
    expect(p1.resultGrid).toMatchObject({ status: "COMPLETE", amount: 4000 })
    expect(p1.spanning).toBe(1)
    expect(p2.resultGrid.status).toBe("INCOMPLETE")
    expect(p2.client.status).toBe("INCOMPLETE")
  })

  test("target progress: no actual is 'not recorded', not 0%", () => {
    const base = { project_id: "p1", metric: "LEADS", unit: "leads", baseline: null, period_start: "2026-10-01", period_end: "2026-10-31" }
    const rows = targetProgress(
      [
        { ...base, target: 20, actual: null },
        { ...base, target: 20, actual: 5 },
        { ...base, target: 0, actual: 3 },
        { ...base, target: 5, actual: 5, period_start: "2026-08-01", period_end: "2026-08-31" },
      ],
      OCT
    )
    expect(rows.map((r) => r.percent)).toEqual([null, 25, null])
  })
})

test.describe("list search is literal (I04)", () => {
  test("wildcards and filter syntax in the search text are escaped", () => {
    expect(searchAny(["name"], "abc")).toBe('name.imatch."abc"')
    expect(searchAny(["a", "b"], "x")).toBe('a.imatch."x",b.imatch."x"')
    // LIKE wildcards aren't special in a regex; regex specials are escaped
    // (one backslash), and that backslash is escaped again inside the quotes.
    expect(searchAny(["name"], "50%_off")).toBe('name.imatch."50%_off"')
    expect(searchAny(["name"], "Alpha*")).toBe('name.imatch."Alpha\\\\*"')
    expect(searchAny(["name"], "a.b(c)")).toBe('name.imatch."a\\\\.b\\\\(c\\\\)"')
    expect(searchAny(["name"], 'x,"y')).toBe('name.imatch."x,\\"y"')
    expect(searchAny(["name"], "a\\b")).toBe('name.imatch."a\\\\\\\\b"')
  })

  test("list links keep the other filters", () => {
    expect(withParams("/leads", { stage: "NEW", q: "x" }, { q: "" })).toBe("/leads?stage=NEW")
    expect(withParams("/leads", {}, {})).toBe("/leads")
  })
})
