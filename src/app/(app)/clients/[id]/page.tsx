import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { updateClientBusinessAction } from "@/app/(app)/clients/actions"
import { ClientBusinessForm } from "@/app/(app)/clients/client-form"
import { ClientLifecycleControls } from "@/app/(app)/clients/[id]/archive-restore-button"
import { deletionEligibility } from "@/lib/domain/project"
import { getTimezoneOptions } from "@/lib/domain/timezones"
import type {
  ClientBusinessRecordType,
  ClientBusinessStatus,
} from "@/lib/domain/enums"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function ClientBusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: client } = await supabase
    .from("client_businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (!client) {
    notFound()
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_name, lifecycle_status, readiness_status")
    .eq("client_business_id", id)
    .order("created_at", { ascending: false })

  const timezones = getTimezoneOptions()
  const updateAction = updateClientBusinessAction.bind(null, id)
  // Safe: guaranteed by the client_businesses CHECK constraints, which the
  // hand-generated Database type (see src/lib/supabase/types.ts) can't see.
  const status = client.status as ClientBusinessStatus
  const recordType = client.record_type as ClientBusinessRecordType
  const openProjectCount = (projects ?? []).filter(
    (p) => p.lifecycle_status === "ACTIVE" || p.lifecycle_status === "ON_HOLD"
  ).length
  let deletion: { eligibleOn: string; eligibleNow: boolean } | null = null
  if (status === "ARCHIVED" && client.archived_at) {
    deletion = deletionEligibility(client.archived_at)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{client.display_name}</h1>
          {status === "ARCHIVED" ? (
            <Badge variant="secondary">Archived</Badge>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientLifecycleControls
            id={client.id}
            displayName={client.display_name}
            status={status}
            openProjectCount={openProjectCount}
            projectCount={projects?.length ?? 0}
            deletion={deletion}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          {status === "ARCHIVED" ? (
            <p className="mb-4 text-sm text-muted-foreground">Read-only while archived. Restore to edit.</p>
          ) : null}
          <ClientBusinessForm
            action={updateAction}
            timezones={timezones}
            submitLabel="Save changes"
            defaultValues={{
              displayName: client.display_name,
              recordType,
              country: client.country,
              timezone: client.timezone,
              legalName: client.legal_name ?? "",
              website: client.website ?? "",
              industry: client.industry ?? "",
              primaryContactName: client.primary_contact_name ?? "",
              email: client.email ?? "",
              phone: client.phone ?? "",
              address: client.address ?? "",
              internalNotes: client.internal_notes ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!projects || projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet for this client.
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{project.project_name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{project.lifecycle_status}</Badge>
                    <Badge variant="outline">{project.readiness_status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {client.status === "ACTIVE" ? (
            <Link
              href={`/projects/new?clientId=${client.id}`}
              className="text-sm underline"
            >
              New project for this client
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">
              Restore this record to add new projects.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
