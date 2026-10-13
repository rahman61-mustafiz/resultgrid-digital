import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { ListFilters } from "@/components/list-filters"
import { param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { versionLabel } from "@/lib/export/package-name"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const STATUSES = ["current", "archived", "all"] as const
const SORTS = ["newest", "oldest"] as const
const SHOWN = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Exports (I03): every approved, immutable export package across projects
 * (H07-H09). Archived exports stay listed (filter) and downloadable;
 * nothing here is ever deleted.
 */
export default async function ExportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = searchText(params)
  const status = pick(param(params, "status"), STATUSES, "current")
  const sort = pick(param(params, "sort"), SORTS, "newest")
  const projectParam = param(params, "project")
  const projectId = UUID.test(projectParam) ? projectParam : ""

  const supabase = await createClient()
  // The archive filter runs here (the latest event decides), so every
  // export and every archive event is read -- never a capped first page.
  const [projectsRes, rowsRes, eventsRes] = await Promise.all([
    fetchAll((a, b) =>
      supabase.from("projects").select("id, project_name, client_business_id, client_businesses(display_name)").order("id").range(a, b)
    ),
    fetchAll((a, b) => supabase.from("project_exports").select("id, project_id, version, generated_at").order("id").range(a, b)),
    fetchAll((a, b) => supabase.from("project_export_archive_events").select("export_id, event_type, seq").order("seq").range(a, b)),
  ])
  const failed = [projectsRes, rowsRes, eventsRes].find((r) => !r.ok)
  const error = failed && !failed.ok ? { message: failed.message } : null
  const projects = [...projectsRes.rows].sort((x, y) => x.project_name.localeCompare(y.project_name))

  // Search matches the project or client name, literally and case-insensitively.
  const needle = q.toLowerCase()
  const projectMatches = (p: (typeof projects)[number]) =>
    (!projectId || p.id === projectId) &&
    (!q || p.project_name.toLowerCase().includes(needle) || (p.client_businesses?.display_name ?? "").toLowerCase().includes(needle))
  const allowed = new Set(projects.filter(projectMatches).map((p) => p.id))

  const archived = new Set<string>()
  for (const e of eventsRes.rows) {
    if (e.event_type === "ARCHIVED") archived.add(e.export_id)
    else archived.delete(e.export_id)
  }
  const matching = rowsRes.rows
    .filter((r) => allowed.has(r.project_id))
    .filter((r) => (status === "all" ? true : status === "archived" ? archived.has(r.id) : !archived.has(r.id)))
    .sort((x, y) => (sort === "oldest" ? x.generated_at.localeCompare(y.generated_at) : y.generated_at.localeCompare(x.generated_at)))
  const exports = matching.slice(0, SHOWN)

  const total = rowsRes.rows.length
  const byId = new Map(projects.map((p) => [p.id, p]))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Exports</h1>
        <p className="text-sm text-muted-foreground">
          Approved AI Markdown export packages. They are immutable and never deleted; archived ones stay downloadable.
        </p>
      </div>

      {total === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No exports yet. An export is created when a project is approved on its{" "}
            <Link href="/projects?readiness=READY_FOR_REVIEW" className="underline">
              readiness page
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <>
          <ListFilters
            action="/exports"
            searchLabel="Project or client"
            q={q}
            selects={[
              {
                name: "project",
                label: "Project",
                value: projectId,
                options: [{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.project_name }))],
              },
              {
                name: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "current", label: "Not archived" },
                  { value: "archived", label: "Archived" },
                  { value: "all", label: "All" },
                ],
              },
              {
                name: "sort",
                label: "Sort",
                value: sort,
                options: [
                  { value: "newest", label: "Newest first" },
                  { value: "oldest", label: "Oldest first" },
                ],
              },
            ]}
            resultCount={error ? undefined : matching.length}
            shown={exports.length}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load exports. Reload the page to try again.
            </p>
          ) : exports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No exports match these filters.{" "}
              <Link href="/exports" className="underline">
                Clear the filters
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border" data-testid="export-list">
              {exports.map((x) => {
                const project = byId.get(x.project_id)
                const base = `/projects/${x.project_id}/readiness/exports/${x.version}`
                return (
                  <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-col">
                      <Link href={base} className="font-medium underline">
                        {project?.project_name ?? "Project"} · {versionLabel(x.version)}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {project?.client_businesses?.display_name ?? ""} · generated {x.generated_at.slice(0, 10)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {archived.has(x.id) ? <Badge variant="secondary">Archived</Badge> : null}
                      <Button asChild variant="outline" size="sm">
                        <a href={`${base}/download`}>Download ZIP</a>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
