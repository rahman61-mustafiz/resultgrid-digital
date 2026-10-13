import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { StageForm } from "@/app/(app)/leads/[id]/stage-form"
import { FollowupButton } from "@/app/(app)/leads/[id]/followup-button"
import { setLeadArchivedAction } from "@/app/(app)/leads/actions"
import { ReasonAction } from "@/components/reason-action"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle()

  if (!lead) {
    notFound()
  }
  const archived = lead.archived_at !== null

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{lead.name}</h1>
        <div className="flex items-center gap-2">
          {archived ? <Badge variant="secondary">Archived</Badge> : null}
          <Badge variant="outline">{lead.stage}</Badge>
        </div>
      </div>

      {archived ? (
        <Card data-testid="lead-archived">
          <CardHeader>
            <CardTitle className="text-base">Archived</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              {`Archived ${lead.archived_at?.slice(0, 10)}: “${lead.archive_reason}”.`} Read-only until restored;
              leads are never deleted.
            </p>
            <ReasonAction
              action={setLeadArchivedAction.bind(null, lead.id, false)}
              label="Restore lead"
              testId="lead-restore"
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {lead.business_name ? <p>Business: {lead.business_name}</p> : null}
          {lead.phone ? <p>Phone: {lead.phone}</p> : null}
          {lead.email ? <p>Email: {lead.email}</p> : null}
          {lead.service_needed ? <p>Service needed: {lead.service_needed}</p> : null}
          {lead.budget ? <p>Budget: {lead.budget}</p> : null}
          {lead.source ? <p>Source: {lead.source}</p> : null}
          <p className="text-muted-foreground">Consent: {lead.consent ? "Given" : "Not recorded"}</p>
          {lead.qualification_reason ? (
            <p className="text-muted-foreground">Reason: {lead.qualification_reason}</p>
          ) : null}
        </CardContent>
      </Card>

      {archived ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <StageForm leadId={lead.id} currentStage={lead.stage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Follow-up</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {lead.last_followup_at
                  ? `Last followed up ${new Date(lead.last_followup_at).toLocaleString()}.`
                  : "No follow-up logged yet."}{" "}
                Reminders stop after 3 attempts; the system never sends anything automatically.
              </p>
              <div>
                <FollowupButton leadId={lead.id} followupCount={lead.followup_count} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archive</CardTitle>
            </CardHeader>
            <CardContent>
              <ReasonAction
                action={setLeadArchivedAction.bind(null, lead.id, true)}
                label="Archive lead"
                note="Archiving hides the lead from the default list and makes it read-only. It can be restored."
                testId="lead-archive"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
