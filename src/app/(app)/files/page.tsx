import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { ListFilters } from "@/components/list-filters"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { searchAny, param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { formatBytes } from "@/lib/evidence/attachments"
import { EVIDENCE_CATEGORIES, EVIDENCE_STATUSES } from "@/lib/domain/enums"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

const CATEGORIES = ["all", ...EVIDENCE_CATEGORIES] as const
const VERIFICATIONS = ["all", ...EVIDENCE_STATUSES] as const
const KINDS = ["all", "file", "link"] as const
const STATUSES = ["current", "removed", "all"] as const
const SORTS = ["newest", "oldest", "evidence_date"] as const
const SHOWN = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Files (I03): every project's evidence -- links and attached files -- in
 * one searchable list. Adding and removing stay on each project's evidence
 * page, where the retention rules are explained.
 */
export default async function FilesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = searchText(params)
  const category = pick(param(params, "category"), CATEGORIES, "all")
  const verification = pick(param(params, "verification"), VERIFICATIONS, "all")
  const kind = pick(param(params, "kind"), KINDS, "all")
  const status = pick(param(params, "status"), STATUSES, "current")
  const sort = pick(param(params, "sort"), SORTS, "newest")
  const projectParam = param(params, "project")
  const projectId = UUID.test(projectParam) ? projectParam : ""

  const supabase = await createClient()
  const projectsRes = await fetchAll((a, b) =>
    supabase.from("projects").select("id, project_name, client_businesses(display_name)").order("id").range(a, b)
  )
  const projects = [...projectsRes.rows].sort((x, y) => x.project_name.localeCompare(y.project_name))

  let query = supabase
    .from("evidence_items")
    .select(
      "id, project_id, category, original_filename, external_url, storage_path, size_bytes, verification_status, evidence_date, notes, created_at, removed_at, removal_reason",
      { count: "exact" }
    )
  if (q) query = query.or(searchAny(["original_filename", "external_url", "notes"], q))
  if (projectId) query = query.eq("project_id", projectId)
  if (category !== "all") query = query.eq("category", category)
  if (verification !== "all") query = query.eq("verification_status", verification)
  if (kind === "file") query = query.not("storage_path", "is", null)
  else if (kind === "link") query = query.is("storage_path", null)
  if (status === "current") query = query.is("removed_at", null)
  else if (status === "removed") query = query.not("removed_at", "is", null)
  query =
    sort === "evidence_date"
      ? query.order("evidence_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
      : query.order("created_at", { ascending: sort === "oldest" })
  const { data: items, error, count } = await query.limit(SHOWN)

  const { count: total } = await supabase.from("evidence_items").select("id", { count: "exact", head: true })
  const projectName = new Map(projects.map((p) => [p.id, `${p.project_name} · ${p.client_businesses?.display_name ?? ""}`]))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Files &amp; evidence</h1>
        <p className="text-sm text-muted-foreground">
          Every project&apos;s evidence links and attached files. Add or remove evidence on the project&apos;s Evidence page.
        </p>
      </div>

      {total === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No evidence yet. Open a{" "}
            <Link href="/projects" className="underline">
              project
            </Link>{" "}
            and add evidence from its Evidence page.
          </CardContent>
        </Card>
      ) : (
        <>
          <ListFilters
            action="/files"
            searchLabel="File name, link or notes"
            q={q}
            selects={[
              {
                name: "project",
                label: "Project",
                value: projectId,
                options: [{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.project_name }))],
              },
              {
                name: "category",
                label: "Category",
                value: category,
                options: [{ value: "all", label: "All" }, ...EVIDENCE_CATEGORIES.map((c) => ({ value: c, label: c }))],
              },
              {
                name: "verification",
                label: "Verification",
                value: verification,
                options: [{ value: "all", label: "All" }, ...EVIDENCE_STATUSES.map((s) => ({ value: s, label: s }))],
              },
              {
                name: "kind",
                label: "Kind",
                value: kind,
                options: [
                  { value: "all", label: "Files and links" },
                  { value: "file", label: "Attached files" },
                  { value: "link", label: "Links" },
                ],
              },
              {
                name: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "current", label: "Current" },
                  { value: "removed", label: "Removed (kept on record)" },
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
                  { value: "evidence_date", label: "Evidence date" },
                ],
              },
            ]}
            resultCount={error ? undefined : count ?? items?.length ?? 0}
            shown={items?.length ?? 0}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load evidence. Reload the page to try again.
            </p>
          ) : !items || items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No evidence matches these filters.{" "}
              <Link href="/files" className="underline">
                Clear the filters
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border" data-testid="file-list">
              {items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="flex min-w-0 flex-col">
                    {item.storage_path ? (
                      <a href={`/projects/${item.project_id}/evidence/${item.id}/file`} className="font-medium underline">
                        {item.original_filename ?? "Attached file"}
                      </a>
                    ) : (
                      <a href={item.external_url ?? undefined} target="_blank" rel="noreferrer" className="truncate font-medium underline">
                        {item.original_filename || item.external_url}
                      </a>
                    )}
                    <span className="text-xs text-muted-foreground">
                      <Link href={`/projects/${item.project_id}/evidence`} className="underline">
                        {projectName.get(item.project_id) ?? "Project"}
                      </Link>
                      {` · ${item.category}`}
                      {item.evidence_date ? ` · ${item.evidence_date}` : ""}
                      {item.storage_path && item.size_bytes ? ` · file, ${formatBytes(item.size_bytes)}` : " · link"}
                    </span>
                    {item.removed_at ? (
                      <span className="text-xs text-muted-foreground">
                        Removed {item.removed_at.slice(0, 10)}: {item.removal_reason}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.removed_at ? <Badge variant="secondary">Removed (kept)</Badge> : null}
                    <Badge variant="outline">{item.verification_status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
