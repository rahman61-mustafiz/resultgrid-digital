import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export default async function AuditLogPage() {
  const supabase = await createClient()
  const { data: events } = await supabase
    .from("security_events")
    .select("id, event_type, metadata, ip_address, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(100)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-semibold">Security audit log</h1>

      {!events || events.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No security events yet.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {events.map((e) => {
            const metadata =
              e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
                ? (e.metadata as Record<string, unknown>)
                : {}
            return (
              <div key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{e.event_type}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                    {typeof metadata.emailAttempted === "string"
                      ? ` · ${metadata.emailAttempted}`
                      : ""}
                  </span>
                </div>
                <Badge variant="outline">{String(e.ip_address ?? "unknown IP")}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
