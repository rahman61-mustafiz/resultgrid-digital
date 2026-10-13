import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { ListFilters } from "@/components/list-filters"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { searchAny, param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { PROJECT_TYPE_LABELS } from "@/lib/domain/project-labels"
import {
  PROJECT_LIFECYCLE_STATUSES,
  PROJECT_READINESS_STATUSES,
  PROJECT_TYPES,
  type ProjectType,
} from "@/lib/domain/enums"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const LIFECYCLES = ["open", ...PROJECT_LIFECYCLE_STATUSES, "all"] as const
const READINESS = ["all", ...PROJECT_READINESS_STATUSES] as const
const TYPES = ["all", ...PROJECT_TYPES] as const
const SORTS = ["newest", "oldest", "name"] as const
const SHOWN = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = searchText(params)
  const lifecycle = pick(param(params, "lifecycle"), LIFECYCLES, "open")
  const readiness = pick(param(params, "readiness"), READINESS, "all")
  const type = pick(param(params, "type"), TYPES, "all")
  const sort = pick(param(params, "sort"), SORTS, "newest")
  const clientParam = param(params, "client")
  const clientId = UUID.test(clientParam) ? clientParam : ""

  const supabase = await createClient()
  const clientsRes = await fetchAll((a, b) => supabase.from("client_businesses").select("id, display_name").order("id").range(a, b))
  const clients = [...clientsRes.rows].sort((x, y) => x.display_name.localeCompare(y.display_name))

  let query = supabase
    .from("projects")
    .select("id, project_name, project_type, lifecycle_status, readiness_status, client_businesses(display_name)", { count: "exact" })
  if (q) {
    // Matching client names count too: every matching client, not a capped list.
    const ids = clients.filter((c) => c.display_name.toLowerCase().includes(q.toLowerCase())).map((c) => c.id)
    const byClient = ids.length ? `,client_business_id.in.(${ids.join(",")})` : ""
    query = query.or(searchAny(["project_name", "short_description"], q) + byClient)
  }
  if (lifecycle === "open") query = query.neq("lifecycle_status", "ARCHIVED")
  else if (lifecycle !== "all") query = query.eq("lifecycle_status", lifecycle)
  if (readiness !== "all") query = query.eq("readiness_status", readiness)
  if (type !== "all") query = query.eq("project_type", type)
  if (clientId) query = query.eq("client_business_id", clientId)
  query = sort === "name" ? query.order("project_name") : query.order("created_at", { ascending: sort === "oldest" })
  const { data: projects, error: queryError, count } = await query.limit(SHOWN)
  const error = queryError ?? (clientsRes.ok ? null : { message: clientsRes.message })

  const { count: total } = await supabase.from("projects").select("id", { count: "exact", head: true })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Button asChild>
          <Link href="/projects/new">New project</Link>
        </Button>
      </div>

      {total === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No projects yet.{" "}
            <Link href="/projects/new" className="underline">
              Create the first one
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <>
          <ListFilters
            action="/projects"
            searchLabel="Project, description or client"
            q={q}
            selects={[
              {
                name: "client",
                label: "Client",
                value: clientId,
                options: [{ value: "", label: "All clients" }, ...clients.map((c) => ({ value: c.id, label: c.display_name }))],
              },
              {
                name: "lifecycle",
                label: "Lifecycle",
                value: lifecycle,
                options: [
                  { value: "open", label: "Not archived" },
                  ...PROJECT_LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s })),
                  { value: "all", label: "All" },
                ],
              },
              {
                name: "readiness",
                label: "Readiness",
                value: readiness,
                options: [{ value: "all", label: "All" }, ...PROJECT_READINESS_STATUSES.map((s) => ({ value: s, label: s }))],
              },
              {
                name: "type",
                label: "Type",
                value: type,
                options: [{ value: "all", label: "All types" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_LABELS[t] }))],
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
            resultCount={error ? undefined : count ?? projects?.length ?? 0}
            shown={projects?.length ?? 0}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load projects. Reload the page to try again.
            </p>
          ) : !projects || projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects match these filters.{" "}
              <Link href="/projects" className="underline">
                Clear the filters
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border" data-testid="project-list">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{project.project_name}</span>
                    <span className="text-muted-foreground">
                      {project.client_businesses?.display_name} &middot;{" "}
                      {PROJECT_TYPE_LABELS[project.project_type as ProjectType]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{project.lifecycle_status}</Badge>
                    <Badge variant="outline">{project.readiness_status}</Badge>
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
