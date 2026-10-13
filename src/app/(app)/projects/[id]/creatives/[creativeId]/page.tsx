import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { ContentForm } from "@/app/(app)/projects/[id]/creatives/[creativeId]/content-form"
import { StatusForm } from "@/app/(app)/projects/[id]/creatives/[creativeId]/status-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function CreativeDetailPage({
  params,
}: {
  params: Promise<{ id: string; creativeId: string }>
}) {
  const { id, creativeId } = await params
  const supabase = await createClient()

  const { data: creative } = await supabase
    .from("creatives")
    .select("*")
    .eq("id", creativeId)
    .maybeSingle()

  if (!creative) {
    notFound()
  }

  const history = Array.isArray(creative.version_history)
    ? (creative.version_history as {
        version: number
        copy: string | null
        asset_url: string | null
        changed_at: string
      }[])
    : []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{creative.title}</h1>
        <Badge variant="outline">v{creative.version}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusForm
            creativeId={creative.id}
            projectId={id}
            currentStatus={creative.status}
          />
          {creative.approved_at ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Approved {new Date(creative.approved_at).toLocaleString()}
              {creative.approval_note ? ` · ${creative.approval_note}` : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content (v{creative.version})</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentForm
            creativeId={creative.id}
            projectId={id}
            copy={creative.copy ?? ""}
            assetUrl={creative.asset_url ?? ""}
          />
        </CardContent>
      </Card>

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {history
              .slice()
              .reverse()
              .map((h, i) => (
                <div key={i} className="border-b pb-2 last:border-b-0">
                  <p className="font-medium">
                    v{h.version} &middot; {new Date(h.changed_at).toLocaleString()}
                  </p>
                  {h.copy ? <p className="text-muted-foreground">{h.copy}</p> : null}
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
