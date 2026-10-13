/**
 * Business-rule rejections raised by the lifecycle/archive/delete RPCs and
 * triggers (supabase/migrations/20261008100000_lifecycle_archive_delete_rules.sql)
 * use plain `raise exception` (SQLSTATE P0001) with a message written for
 * the Owner, e.g. "this project is archived and read-only: restore it
 * first". Those are shown as-is (first letter capitalized); anything else
 * gets the caller's generic fallback rather than a raw database error.
 * 42501 here is the recent-reauth check inside the permanent-delete RPCs.
 */
export function ruleErrorMessage(
  error: { code?: string; message: string } | null,
  fallback: string
): string {
  if (error && (error.code === "P0001" || error.code === "42501") && error.message) {
    const m = error.message
    return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".")
  }
  return fallback
}
