import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type FilterSelect = {
  name: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
}

export type FilterDate = { name: string; label: string; value: string }

const SELECT_CLASS =
  "border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

/**
 * Search, filter and sort bar for a list page (I04). A plain GET form:
 * the state is in the URL, it works without JavaScript, and it stays
 * usable on the view-only phone layout (reading, not writing).
 */
export function ListFilters({
  action,
  searchLabel,
  q,
  selects = [],
  dates = [],
  hidden = {},
  resultCount,
  shown,
}: {
  action: string
  searchLabel?: string
  q?: string
  selects?: FilterSelect[]
  dates?: FilterDate[]
  hidden?: Record<string, string>
  /** How many rows match the filters (all of them, not just those shown). */
  resultCount?: number
  /** How many are shown, when the list shows only the first part. */
  shown?: number
}) {
  return (
    <form method="get" action={action} role="search" className="flex flex-col gap-2" data-testid="list-filters">
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      <div className="flex flex-wrap items-end gap-3">
        {searchLabel ? (
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            {searchLabel}
            <Input type="search" name="q" defaultValue={q} placeholder="Search" maxLength={100} />
          </label>
        ) : null}
        {selects.map((s) => (
          <label key={s.name} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {s.label}
            <select name={s.name} defaultValue={s.value} className={SELECT_CLASS}>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {dates.map((d) => (
          <label key={d.name} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {d.label}
            <Input type="date" name={d.name} defaultValue={d.value} className="w-40" />
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          <Button asChild variant="ghost">
            <Link href={action}>Clear</Link>
          </Button>
        </div>
      </div>
      {resultCount !== undefined ? (
        <p className="text-xs text-muted-foreground" role="status" data-testid="result-count">
          {shown !== undefined && shown < resultCount
            ? `Showing the first ${shown} of ${resultCount} results. Narrow the search or filters to see the rest.`
            : `${resultCount} ${resultCount === 1 ? "result" : "results"}`}
        </p>
      ) : null}
    </form>
  )
}
