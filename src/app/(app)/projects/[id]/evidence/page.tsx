import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { EvidenceForm } from "@/app/(app)/projects/[id]/evidence/evidence-form"
import { RemoveEvidenceButton } from "@/app/(app)/projects/[id]/evidence/remove-button"
import { CleanupRetryButton } from "@/app/(app)/projects/[id]/evidence/cleanup-retry-button"
import { formatBytes } from "@/lib/evidence/attachments"
import type { Tables } from "@/lib/supabase/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type EvidenceRow = Tables<"evidence_items">

function EvidenceLink({ item, projectId }: { item: EvidenceRow; projectId: string }) {
  if (item.storage_path) {
    return (
      <a
        href={`/projects/${projectId}/evidence/${item.id}/file`}
        className="font-medium underline"
        data-testid="evidence-file-link"
      >
        {item.original_filename ?? "Attached file"}
      </a>
    )
  }
  return (
    <a href={item.external_url ?? undefined} target="_blank" rel="noreferrer" className="font-medium underline">
      {item.original_filename || item.external_url}
    </a>
  )
}

function Meta({ item }: { item: EvidenceRow }) {
  return (
    <span className="text-xs text-muted-foreground">
      {item.category}
      {item.evidence_date ? ` · ${item.evidence_date}` : ""}
      {item.storage_path && item.size_bytes ? ` · file, ${formatBytes(item.size_bytes)}` : " · link"}
    </span>
  )
}

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name")
    .eq("id", id)
    .maybeSingle()

  if (!project) {
    notFound()
  }

  const { data: items } = await supabase
    .from("evidence_items")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
  const { data: exported } = items?.length
    ? await supabase
        .from("project_export_evidence")
        .select("evidence_item_id")
        .in("evidence_item_id", items.map((i) => i.id))
    : { data: [] }
  const inExport = new Set((exported ?? []).map((r) => r.evidence_item_id))
  // Files of deleted evidence still waiting to be deleted from Storage.
  const { data: pendingCleanup } = await supabase
    .from("storage_cleanup_queue")
    .select("id, attempts, last_error, enqueued_at")
    .eq("project_id", id)
    .is("completed_at", null)
    .order("enqueued_at")
  const current = (items ?? []).filter((i) => !i.removed_at)
  const removed = (items ?? []).filter((i) => i.removed_at)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Evidence &amp; files</h1>
        <p className="text-sm text-muted-foreground">
          {project.project_name} ·{" "}
          <Link href={`/files?project=${id}&status=all`} className="underline">
            Search and filter this project&apos;s evidence
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <EvidenceForm projectId={id} />
        </CardContent>
      </Card>

      {pendingCleanup?.length ? (
        <Card data-testid="pending-file-deletions">
          <CardHeader>
            <CardTitle className="text-base">
              {pendingCleanup.length} file deletion{pendingCleanup.length === 1 ? "" : "s"} pending
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              The evidence is gone; its stored file is queued for deletion and is retried after each evidence change.
              The file stays private in the meantime.
            </p>
            {pendingCleanup.map((c) => (
              <span key={c.id} className="text-xs text-muted-foreground">
                Queued {c.enqueued_at.slice(0, 10)} · {c.attempts} attempt{c.attempts === 1 ? "" : "s"}
                {c.last_error ? ` · last error: ${c.last_error}` : ""}
              </span>
            ))}
            <CleanupRetryButton projectId={id} />
          </CardContent>
        </Card>
      ) : null}

      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">No evidence recorded yet.</p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border" data-testid="current-evidence">
          {current.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="flex flex-col">
                <EvidenceLink item={item} projectId={id} />
                <Meta item={item} />
              </div>
              <div className="flex items-center gap-2">
                {inExport.has(item.id) ? <Badge variant="secondary">In an export</Badge> : null}
                <Badge variant="outline">{item.verification_status}</Badge>
                <RemoveEvidenceButton itemId={item.id} projectId={id} inExport={inExport.has(item.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {removed.length > 0 ? (
        <Card data-testid="removed-evidence">
          <CardHeader>
            <CardTitle className="text-base">Removed (kept on record)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              These were part of an export, so they are kept with their files. They are no longer in new exports.
            </p>
            {removed.map((item) => (
              <div key={item.id} className="flex flex-col">
                <EvidenceLink item={item} projectId={id} />
                <Meta item={item} />
                <span className="text-xs text-muted-foreground">
                  Removed {item.removed_at?.slice(0, 10)}: {item.removal_reason}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
