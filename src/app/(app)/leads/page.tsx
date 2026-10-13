import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { ListFilters } from "@/components/list-filters"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { searchAny, param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { isFollowupDue } from "@/lib/domain/lead"
import { LEAD_STAGES } from "@/lib/domain/enums"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const STAGES = ["all", ...LEAD_STAGES] as const
const STATUSES = ["active", "archived", "all"] as const
const FOLLOWUPS = ["all", "due"] as const
const SORTS = ["newest", "oldest", "name"] as const
const SHOWN = 500

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = searchText(params)
  const stage = pick(param(params, "stage"), STAGES, "all")
  const status = pick(param(params, "status"), STATUSES, "active")
  const followup = pick(param(params, "followup"), FOLLOWUPS, "all")
  const sort = pick(param(params, "sort"), SORTS, "newest")

  const supabase = await createClient()
  const filtered = () => {
    let query = supabase
      .from("leads")
      .select("id, name, business_name, stage, followup_count, last_followup_at, created_at, archived_at", { count: "exact" })
    if (q) query = query.or(searchAny(["name", "business_name", "email", "phone", "service_needed", "source"], q))
    if (stage !== "all") query = query.eq("stage", stage)
    if (status === "active") query = query.is("archived_at", null)
    else if (status === "archived") query = query.not("archived_at", "is", null)
    query = sort === "name" ? query.order("name") : query.order("created_at", { ascending: sort === "oldest" })
    return query.order("id")
  }

  let leads: {
    id: string
    name: string
    business_name: string | null
    stage: string
    followup_count: number
    last_followup_at: string | null
    created_at: string
    archived_at: string | null
  }[]
  let matchCount: number
  let error: { message: string } | null
  if (followup === "due") {
    // Follow-up due is computed from stage, attempts and dates (isFollowupDue),
    // so every lead matching the other filters is read before filtering.
    const all = await fetchAll((a, b) => filtered().range(a, b))
    const due = all.rows.filter((l) => !l.archived_at && isFollowupDue(l))
    error = all.ok ? null : { message: all.message }
    matchCount = due.length
    leads = due.slice(0, SHOWN)
  } else {
    const { data, error: queryError, count } = await filtered().limit(SHOWN)
    error = queryError
    leads = data ?? []
    matchCount = count ?? leads.length
  }

  const { count: total } = await supabase.from("leads").select("id", { count: "exact", head: true })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <Button asChild>
          <Link href="/leads/new">New lead</Link>
        </Button>
      </div>

      {total === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No leads yet.{" "}
            <Link href="/leads/new" className="underline">
              Add the first one
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <>
          <ListFilters
            action="/leads"
            searchLabel="Name, business, email, phone, service or source"
            q={q}
            selects={[
              {
                name: "stage",
                label: "Stage",
                value: stage,
                options: [{ value: "all", label: "All stages" }, ...LEAD_STAGES.map((s) => ({ value: s, label: s }))],
              },
              {
                name: "followup",
                label: "Follow-up",
                value: followup,
                options: [
                  { value: "all", label: "Any" },
                  { value: "due", label: "Due now" },
                ],
              },
              {
                name: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "active", label: "Active" },
                  { value: "archived", label: "Archived" },
                  { value: "all", label: "Active and archived" },
                ],
              },
              {
                name: "sort",
                label: "Sort",
                value: sort,
                options: [
                  { value: "newest", label: "Newest first" },
                  { value: "oldest", label: "Oldest first" },
                  { value: "name", label: "Name (A-Z)" },
                ],
              },
            ]}
            resultCount={error ? undefined : matchCount}
            shown={leads.length}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load leads. Reload the page to try again.
            </p>
          ) : leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads match these filters.{" "}
              <Link href="/leads" className="underline">
                Clear the filters
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border" data-testid="lead-list">
              {leads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{lead.name}</span>
                    <span className="text-muted-foreground">{lead.business_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {lead.archived_at ? <Badge variant="secondary">Archived</Badge> : null}
                    {!lead.archived_at && isFollowupDue(lead) ? <Badge variant="destructive">Follow-up due</Badge> : null}
                    <Badge variant="outline">{lead.stage}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
