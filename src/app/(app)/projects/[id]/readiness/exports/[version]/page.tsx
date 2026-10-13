import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { loadExport } from "@/lib/export/load-export"
import { versionLabel as labelFor } from "@/lib/export/package-name"
import { ExportArchiveControls } from "@/app/(app)/projects/[id]/readiness/exports/[version]/archive-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function FilePreview({ name, content }: { name: string; content: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{name}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">
          {content}
        </pre>
      </CardContent>
    </Card>
  )
}

export default async function ExportViewPage({
  params,
}: {
  params: Promise<{ id: string; version: string }>
}) {
  const { id, version } = await params
  const supabase = await createClient()

  const loaded = await loadExport(supabase, id, version)
  if (!loaded) {
    notFound()
  }
  const { row: exportRow, packageName } = loaded
  const versionLabel = labelFor(exportRow.version)

  const { data: lastArchiveEvent } = await supabase
    .from("project_export_archive_events")
    .select("event_type, reason, created_at")
    .eq("export_id", exportRow.id)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle()
  const archived = lastArchiveEvent?.event_type === "ARCHIVED"

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          Export package &mdash; {versionLabel} {archived ? <Badge variant="secondary">Archived</Badge> : null}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`/projects/${id}/readiness/exports/${exportRow.version}/download`} download data-testid="download-zip">
              Download package (ZIP)
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`/projects/${id}/readiness/exports/${exportRow.version}/context`} download data-testid="download-context">
              Download PROJECT_CONTEXT.md
            </a>
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="font-mono" data-testid="package-name">{packageName}</span> &middot; generated{" "}
        {new Date(exportRow.generated_at).toLocaleString()} &middot; immutable
        {archived && lastArchiveEvent ? <> &middot; archived {lastArchiveEvent.created_at.slice(0, 10)}{lastArchiveEvent.reason ? `: ${lastArchiveEvent.reason}` : ""}</> : null}
      </p>
      <ExportArchiveControls projectId={id} exportId={exportRow.id} archived={archived} />

      <FilePreview name="PROJECT_CONTEXT.md" content={exportRow.content} />
      <FilePreview name="EVIDENCE_INDEX.md" content={exportRow.evidence_index_content} />
      <FilePreview name="EXPORT_MANIFEST.md" content={exportRow.export_manifest_content} />
    </div>
  )
}
