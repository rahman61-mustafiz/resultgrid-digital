import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { CreativeForm } from "@/app/(app)/projects/[id]/creatives/creative-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function CreativesPage({
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

  const { data: creatives } = await supabase
    .from("creatives")
    .select("id, title, channel, status, version")
    .eq("project_id", id)
    .order("created_at", { ascending: false })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Creative workflow</h1>
        <p className="text-sm text-muted-foreground">{project.project_name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New creative</CardTitle>
        </CardHeader>
        <CardContent>
          <CreativeForm projectId={id} />
        </CardContent>
      </Card>

      {!creatives || creatives.length === 0 ? (
        <p className="text-sm text-muted-foreground">No creatives yet.</p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {creatives.map((c) => (
            <Link
              key={c.id}
              href={`/projects/${id}/creatives/${c.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50"
            >
              <div className="flex flex-col">
                <span className="font-medium">{c.title}</span>
                <span className="text-xs text-muted-foreground">
                  {c.channel} &middot; v{c.version}
                </span>
              </div>
              <Badge variant="outline">{c.status}</Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
