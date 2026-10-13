import { expect, test } from "@playwright/test"

import { parseReportPeriod, reportPeriodOptions, selectReportRows } from "@/lib/reports/report-rules"
import { fetchAll } from "@/lib/supabase/fetch-all"

// Saturday 10 October 2026, 02:30 in Dhaka; still Friday 9 October in UTC.
const NOW = new Date("2026-10-09T20:30:00Z")
const row = (start: string, end: string, amount = 1) => ({ period_start: start, period_end: end, amount })
const financials = [
  row("2026-10-01", "2026-10-31", 100), // the whole month
  row("2026-09-20", "2026-10-05", 50), // straddles 1 October
  row("2026-10-10", "2026-10-10", 7), // today in Dhaka, tomorrow in UTC
]
const targets = [row("2026-10-01", "2026-12-31"), row("2026-08-01", "2026-08-31")]

test.describe("client report rules (M07, versioned per share link)", () => {
  test("v2 offers weekly and quarterly periods; v1 keeps its original list", () => {
    expect(reportPeriodOptions(2).map((o) => o.key)).toEqual([
      "all",
      "this_week",
      "last_week",
      "this_month",
      "last_month",
      "this_quarter",
      "last_quarter",
      "this_year",
    ])
    expect(reportPeriodOptions(1).map((o) => o.key)).toEqual(["all", "this_month", "last_month", "this_quarter", "this_year"])
    expect(parseReportPeriod(1, "this_week"), "v1 links don't gain new periods").toBe("all")
    expect(parseReportPeriod(2, "nonsense")).toBe("all")
  })

  test("v2 counts only records inside the period, in the project's timezone, and notes the rest", () => {
    const month = selectReportRows({ financials, targets, timeZone: "Asia/Dhaka" }, "this_month", 2, NOW)
    expect(month.periodLabel).toBe("2026-10-01 to 2026-10-31")
    expect(month.financials.map((f) => f.amount)).toEqual([100, 7])
    expect(month.spanning).toBe(1)
    expect(month.targets).toHaveLength(1)

    const week = selectReportRows({ financials, targets, timeZone: "Asia/Dhaka" }, "this_week", 2, NOW)
    expect(week.periodLabel).toBe("2026-10-05 to 2026-10-11")
    expect(week.financials.map((f) => f.amount), "the 10 October record is this week in Dhaka").toEqual([7])
    expect(week.spanning).toBe(2)

    const utcWeek = selectReportRows({ financials, targets, timeZone: "UTC" }, "this_week", 2, NOW)
    expect(utcWeek.periodLabel, "the same instant in UTC is still the same week").toBe("2026-10-05 to 2026-10-11")
  })

  test("v1 is unchanged: an overlapping record counts in full", () => {
    const month = selectReportRows({ financials, targets, timeZone: "Asia/Dhaka" }, "this_month", 1, NOW)
    expect(month.financials.map((f) => f.amount)).toEqual([100, 50, 7])
    expect(month.spanning).toBe(0)
  })

  test("all time includes everything under both rules", () => {
    for (const rules of [1, 2] as const) {
      const all = selectReportRows({ financials, targets, timeZone: "Asia/Dhaka" }, "all", rules, NOW)
      expect(all.financials).toHaveLength(3)
      expect(all.targets).toHaveLength(2)
    }
  })
})

test.describe("full reads (fetchAll)", () => {
  const pages = (total: number, failAt?: number) => (from: number, to: number) => {
    if (failAt !== undefined && from >= failAt) return Promise.resolve({ data: null, error: { message: "boom" } })
    const end = Math.min(to + 1, total)
    return Promise.resolve({ data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null })
  }

  test("reads every page, past the server's page size", async () => {
    const r = await fetchAll(pages(2500))
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2500)
    expect(r.rows[2499]).toBe(2499)
    expect((await fetchAll(pages(0))).rows).toEqual([])
    expect((await fetchAll(pages(1000))).rows).toHaveLength(1000)
  })

  test("a server that returns fewer rows per page than asked is still read to the end", async () => {
    let calls = 0
    const cap500 = (from: number) => {
      calls += 1
      const end = Math.min(from + 500, 1500)
      return Promise.resolve({ data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null })
    }
    const r = await fetchAll(cap500)
    expect(r.ok).toBe(true)
    expect(r.rows).toEqual(Array.from({ length: 1500 }, (_, i) => i))
    expect(calls, "three pages of 500, then an empty page").toBe(4)
  })

  test("exactly the limit is complete; one more row is not", async () => {
    const exact = await fetchAll(pages(3000), 3000)
    expect(exact.ok).toBe(true)
    expect(exact.rows).toHaveLength(3000)
    const over = await fetchAll(pages(3001), 3000)
    expect(over.ok).toBe(false)
    expect(!over.ok && over.reason).toBe("too-many")
    expect(over.rows).toHaveLength(3000)
  })

  test("an error part-way or too many rows is reported, not returned as complete", async () => {
    const failed = await fetchAll(pages(5000, 2000))
    expect(failed.ok).toBe(false)
    expect(!failed.ok && failed.reason).toBe("error")
    const big = await fetchAll(pages(10_000), 3000)
    expect(big.ok).toBe(false)
    expect(!big.ok && big.reason).toBe("too-many")
  })
})
