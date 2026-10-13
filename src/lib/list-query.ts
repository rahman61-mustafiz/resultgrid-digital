/**
 * Search, filter and sort for the list pages (BUILD_READINESS_QUESTIONNAIRE.md
 * I04: clients, projects, leads, transactions, evidence and reports support
 * search, filter, sort and archive). State lives in the URL (GET), so lists
 * are bookmarkable and work on the view-only phone layout too.
 */

export type SearchParams = Record<string, string | string[] | undefined>

/** The first value of a query parameter, trimmed; "" when absent. */
export function param(params: SearchParams, name: string): string {
  const v = params[name]
  return (Array.isArray(v) ? v[0] : v ?? "").trim()
}

/** A value from an allowed list, or the fallback. */
export function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Search text, length-capped. */
export function searchText(params: SearchParams, name = "q"): string {
  return param(params, name).slice(0, 100)
}

/**
 * A PostgREST `or` filter matching `q` as a case-insensitive substring of
 * any column. It uses a regular-expression match (`imatch`) with every
 * special character escaped, so the text matches literally: LIKE would
 * treat % and _ as wildcards, and PostgREST also turns * into a wildcard
 * in like/ilike. Each pattern is double-quoted so commas, dots and
 * parentheses in the text can't change the filter's structure.
 */
export function searchAny(columns: readonly string[], q: string): string {
  const literal = q.replace(/[\\^$.|?*+()[\]{}-]/g, (c) => `\\${c}`)
  const quoted = `"${literal.replace(/["\\]/g, (c) => `\\${c}`)}"`
  return columns.map((c) => `${c}.imatch.${quoted}`).join(",")
}

/** A link to the same list with some parameters changed ("" removes one). */
export function withParams(path: string, params: SearchParams, changes: Record<string, string>): string {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v
    if (value) next.set(k, value)
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v) next.set(k, v)
    else next.delete(k)
  }
  const qs = next.toString()
  return qs ? `${path}?${qs}` : path
}
