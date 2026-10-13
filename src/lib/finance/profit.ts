import type { FinancialRecordType, ValueStatus } from "@/lib/domain/enums"

export type FinancialRecordRow = {
  record_type: FinancialRecordType
  amount: number
  value_status: ValueStatus
  attributed_to_marketing?: boolean
}

export type CategoryTotal = {
  sum: number
  hasAnyRecord: boolean
  pendingCount: number
  disputedCount: number
}

/**
 * CONFIRMED/ESTIMATED amounts add to the total; REFUNDED amounts subtract
 * (a refund reduces the applicable revenue/profit, per
 * BUILD_READINESS_QUESTIONNAIRE.md M12); DISPUTED and PENDING amounts are
 * excluded from the numeric total (not confirmed yet) but still count as
 * "this category has data", so a category with only a pending entry is
 * reported as pending, not silently treated as zero or as missing.
 */
export function summarizeCategory(
  records: FinancialRecordRow[],
  type: FinancialRecordType
): CategoryTotal {
  const matching = records.filter((r) => r.record_type === type)
  let sum = 0
  let pendingCount = 0
  let disputedCount = 0

  for (const r of matching) {
    switch (r.value_status) {
      case "CONFIRMED":
      case "ESTIMATED":
        sum += r.amount
        break
      case "REFUNDED":
        sum -= r.amount
        break
      case "PENDING":
        pendingCount += 1
        break
      case "DISPUTED":
        disputedCount += 1
        break
    }
  }

  return { sum, hasAnyRecord: matching.length > 0, pendingCount, disputedCount }
}

export type ProfitResult =
  | { status: "COMPLETE"; amount: number; caveats: string[] }
  | { status: "INCOMPLETE"; missingCategories: FinancialRecordType[]; caveats: string[] }

function collectCaveats(categories: CategoryTotal[], labels: string[]): string[] {
  const caveats: string[] = []
  categories.forEach((c, i) => {
    if (c.pendingCount > 0) {
      caveats.push(`${c.pendingCount} pending ${labels[i]} record(s) excluded from this total.`)
    }
    if (c.disputedCount > 0) {
      caveats.push(`${c.disputedCount} disputed ${labels[i]} record(s) excluded from this total.`)
    }
  })
  return caveats
}

/**
 * ResultGrid Digital profit = received client payment - direct project-
 * delivery cost - allocated operating cost (BUILD_READINESS_QUESTIONNAIRE.md
 * E14.Q08). CLIENT_PAYMENT_RECEIVED is required (no payment data at all
 * means the formula can't mean anything); the two cost categories default
 * to 0 when absent -- many small projects genuinely have no separately
 * tracked delivery/operating cost, and treating "no record" as "unknown"
 * there would make this permanently INCOMPLETE for otherwise-simple
 * projects. This is a judgment call, not dictated word-for-word by the
 * spec; revisit if that turns out wrong in practice.
 */
export function computeResultGridProfit(records: FinancialRecordRow[]): ProfitResult {
  const payment = summarizeCategory(records, "CLIENT_PAYMENT_RECEIVED")
  const delivery = summarizeCategory(records, "DIRECT_DELIVERY_COST")
  const operating = summarizeCategory(records, "ALLOCATED_OPERATING_COST")

  if (!payment.hasAnyRecord) {
    return { status: "INCOMPLETE", missingCategories: ["CLIENT_PAYMENT_RECEIVED"], caveats: [] }
  }

  const amount = payment.sum - delivery.sum - operating.sum
  const caveats = collectCaveats(
    [payment, delivery, operating],
    ["client payment", "direct delivery cost", "allocated operating cost"]
  )
  return { status: "COMPLETE", amount, caveats }
}

/**
 * Client profit = marketing-attributed revenue - marketing spend -
 * ResultGrid Digital fee - other agreed campaign cost
 * (BUILD_READINESS_QUESTIONNAIRE.md E14.Q08).
 *
 * "Marketing-attributed revenue" means CLIENT_OWN_REVENUE rows explicitly
 * marked `attributed_to_marketing` -- never the client's total revenue.
 * The project's Do's/Don'ts are explicit: "do not claim marketing-
 * attributed revenue without evidence." The database enforces the
 * evidence half of that (a row can't be marked attributed without
 * evidence -- see the financial_records_attribution_rules CHECK
 * constraint); this function enforces the other half, by only ever
 * summing rows that were actually marked attributed. A project with real
 * CLIENT_OWN_REVENUE rows that are simply never marked attributed is
 * reported the same as having none, with a caveat explaining why -- not
 * silently treated as if the revenue supports the marketing-profit claim.
 */
export function computeClientProfit(records: FinancialRecordRow[]): ProfitResult {
  const attributedRevenueRecords = records.filter(
    (r) => r.record_type === "CLIENT_OWN_REVENUE" && r.attributed_to_marketing
  )
  const revenue = summarizeCategory(attributedRevenueRecords, "CLIENT_OWN_REVENUE")
  const spend = summarizeCategory(records, "MARKETING_SPEND")
  const fee = summarizeCategory(records, "RESULTGRID_FEE")
  const other = summarizeCategory(records, "OTHER_CAMPAIGN_COST")

  const missing: FinancialRecordType[] = []
  if (!revenue.hasAnyRecord) missing.push("CLIENT_OWN_REVENUE")
  if (!spend.hasAnyRecord) missing.push("MARKETING_SPEND")
  if (!fee.hasAnyRecord) missing.push("RESULTGRID_FEE")

  if (missing.length > 0) {
    const caveats: string[] = []
    const unattributedCount = records.filter(
      (r) => r.record_type === "CLIENT_OWN_REVENUE" && !r.attributed_to_marketing
    ).length
    if (unattributedCount > 0) {
      caveats.push(
        `${unattributedCount} client revenue record(s) exist but are not marked attributed to ` +
          "marketing (or lack evidence) -- excluded from this figure, not counted as zero."
      )
    }
    return { status: "INCOMPLETE", missingCategories: missing, caveats }
  }

  const amount = revenue.sum - spend.sum - fee.sum - other.sum
  const caveats = collectCaveats(
    [revenue, spend, fee, other],
    ["marketing-attributed revenue", "marketing spend", "ResultGrid Digital fee", "other campaign cost"]
  )
  caveats.push(
    "Revenue figure includes only records explicitly attributed to marketing with evidence -- not total client revenue."
  )
  return { status: "COMPLETE", amount, caveats }
}
