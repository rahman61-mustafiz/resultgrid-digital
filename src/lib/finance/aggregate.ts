/**
 * Sums amounts per currency, never across currencies -- see
 * BUILD_READINESS_QUESTIONNAIRE.md B09/M06: "Currency totals never
 * combine different currencies." Returns e.g. { BDT: 12000, USD: 400 }
 * rather than a single misleading cross-currency number.
 */
export function sumByCurrency(
  records: { amount: number; currency: string }[]
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const r of records) {
    totals[r.currency] = (totals[r.currency] ?? 0) + r.amount
  }
  return totals
}

export function formatCurrencyTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals)
  if (entries.length === 0) return "None recorded"
  return entries
    .map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`)
    .join(" + ")
}
