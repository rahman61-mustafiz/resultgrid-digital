import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { ListFilters } from "@/components/list-filters"
import { param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const READINESS = ["approved", "not_approved", "all"] as const
const SHARING = ["all", "active", "none"] as const
const SORTS = ["name", "newest"] as const
const SHOWN = 500

/**
 * Reports (I03): each project's client report and its share links. A
 * report exists only for an APPROVED project (it reflects the approved
 * snapshot); share links are project-scoped, PIN-protected and expire.
 */
export default async function ReportsIndexPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = searchText(params)
  const readiness = pick(param(params, "readiness"), READINESS, "all")
  const sharing = pick(param(params, "sharing"), SHARING, "all")
  const sort = pick(param(params, "sort"), SORTS, "name")

  const supabase = await createClient()
  // The sharing filter runs here, so every open project and every active
  // link is read -- never a capped first page.
  const nowIso = new Date().toISOString()
  const [rowsRes, linksRes] = await Promise.all([
    fetchAll((a, b) =>
      supabase
        .from("projects")
        .select("id, project_name, readiness_status, lifecycle_status, created_at, client_businesses(display_name)")
        .neq("lifecycle_status", "ARCHIVED")
        .order("id")
        .range(a, b)
    ),
    fetchAll((a, b) =>
      supabase
        .from("client_share_links")
        .select("id, project_id, expires_at")
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .order("id")
        .range(a, b)
    ),
  ])
  const failed = [rowsRes, linksRes].find((r) => !r.ok)
  const error = failed && !failed.ok ? { message: failed.message } : null

  const activeLinks = new Map<string, { count: number; nextExpiry: string }>()
  for (const l of linksRes.rows) {
    const cur = activeLinks.get(l.project_id)
    activeLinks.set(l.project_id, {
      count: (cur?.count ?? 0) + 1,
      nextExpiry: cur && cur.nextExpiry < l.expires_at ? cur.nextExpiry : l.expires_at,
    })
  }
  // Search matches the project or client name, literally and case-insensitively.
  const needle = q.toLowerCase()
  const matching = rowsRes.rows
    .filter((p) => !q || p.project_name.toLowerCase().includes(needle) || (p.client_businesses?.display_name ?? "").toLowerCase().includes(needle))
    .filter((p) => (readiness === "all" ? true : readiness === "approved" ? p.readiness_status === "APPROVED" : p.readiness_status !== "APPROVED"))
    .filter((p) => (sharing === "all" ? true : sharing === "active" ? activeLinks.has(p.id) : !activeLinks.has(p.id)))
    .sort((x, y) => (sort === "name" ? x.project_name.localeCompare(y.project_name) : y.created_at.localeCompare(x.created_at)))
  const projects = matching.slice(0, SHOWN)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Client reports per project. A report is available once the project is approved; share it with a PIN-protected link
          that expires.
        </p>
      </div>

      <ListFilters
        action="/reports"
        searchLabel="Project or client"
        q={q}
        selects={[
          {
            name: "readiness",
            label: "Report",
            value: readiness,
            options: [
              { value: "all", label: "All projects" },
              { value: "approved", label: "Available (approved)" },
              { value: "not_approved", label: "Not available yet" },
            ],
          },
          {
            name: "sharing",
            label: "Sharing",
            value: sharing,
            options: [
              { value: "all", label: "Any" },
              { value: "active", label: "Active share link" },
              { value: "none", label: "No active link" },
            ],
          },
          {
            name: "sort",
            label: "Sort",
            value: sort,
            options: [
              { value: "name", label: "Name (A-Z)" },
              { value: "newest", label: "Newest first" },
            ],
          },
        ]}
        resultCount={error ? undefined : matching.length}
        shown={projects.length}
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load reports. Reload the page to try again.
        </p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No projects match.{" "}
            <Link href="/reports" className="underline">
              Clear the filters
            </Link>{" "}
            or{" "}
            <Link href="/projects" className="underline">
              open the projects list
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col divide-y rounded-md border" data-testid="report-list">
          {projects.map((p) => {
            const approved = p.readiness_status === "APPROVED"
            const active = activeLinks.get(p.id)
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{p.project_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.client_businesses?.display_name}
                    {active
                      ? ` · ${active.count} active share link${active.count === 1 ? "" : "s"}, next expiry ${active.nextExpiry.slice(0, 10)}`
                      : " · no active share link"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {approved ? (
                    <>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/projects/${p.id}/reports`}>Preview report</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/projects/${p.id}/share-links`}>Share links</Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge variant="outline">{p.readiness_status}</Badge>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/projects/${p.id}/readiness`}>Readiness</Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
