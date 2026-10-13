/**
 * Reads every row of a query, page by page, instead of trusting one capped
 * response. The result says whether it is complete: an error, or more
 * rows than `maxRows`, is reported, never presented as a full set. Callers
 * show "unavailable" or "incomplete", not totals, in that case.
 *
 * No assumption about the server's page size: each request asks for the
 * next rows after those already received, and only an empty page ends the
 * read (a short page may just be the server's cap). Every step either ends
 * or adds rows, and at most `maxRows + 1` rows are ever requested, so the
 * loop always ends. The extra row tells "exactly maxRows" (complete) apart
 * from "more than maxRows".
 *
 * `page(from, to)` must return the same ordered query each time (order by
 * a unique column, e.g. id) with `.range(from, to)` applied.
 */
export type FetchAllResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; rows: T[]; reason: "error" | "too-many"; message: string }

const PAGE = 1000

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 50_000
): Promise<FetchAllResult<T>> {
  const rows: T[] = []
  for (;;) {
    const want = Math.min(PAGE, maxRows + 1 - rows.length)
    const { data, error } = await page(rows.length, rows.length + want - 1)
    if (error) return { ok: false, rows, reason: "error", message: error.message }
    const got = data ?? []
    if (got.length === 0) return { ok: true, rows }
    rows.push(...got.slice(0, want))
    if (rows.length > maxRows) {
      return {
        ok: false,
        rows: rows.slice(0, maxRows),
        reason: "too-many",
        message: `more than ${maxRows.toLocaleString("en-US")} rows`,
      }
    }
  }
}
