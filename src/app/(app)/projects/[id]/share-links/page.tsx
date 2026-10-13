import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { CreateLinkButton } from "@/app/(app)/projects/[id]/share-links/create-link-button"
import { LinkActions } from "@/app/(app)/projects/[id]/share-links/link-actions"
import { isLinkExpired } from "@/lib/domain/share-link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function ShareLinksPage({
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

  const { data: links } = await supabase
    .from("client_share_links")
    .select("id, expires_at, revoked_at, created_at, last_accessed_at, report_rules_version")
    .eq("project_id", id)
    .order("created_at", { ascending: false })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Client share links</h1>
        <p className="text-sm text-muted-foreground">{project.project_name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a link</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateLinkButton projectId={id} />
        </CardContent>
      </Card>

      {!links || links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No links created yet.</p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {links.map((l) => {
            const isRevoked = !!l.revoked_at
            const isExpired = isLinkExpired(l.expires_at)
            return (
              <div key={l.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex flex-col">
                  <span>Expires {new Date(l.expires_at).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.last_accessed_at
                      ? `Last viewed ${new Date(l.last_accessed_at).toLocaleString()}`
                      : "Not viewed yet"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" title={l.report_rules_version === 1 ? "Created before 10 October 2026: overlapping records counted in full" : "Only records dated inside the period"}>
                    Rules v{l.report_rules_version}
                  </Badge>
                  {isRevoked ? (
                    <Badge variant="destructive">Revoked</Badge>
                  ) : isExpired ? (
                    <Badge variant="secondary">Expired</Badge>
                  ) : (
                    <Badge variant="outline">Active</Badge>
                  )}
                  <LinkActions linkId={l.id} projectId={id} isRevoked={isRevoked} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
