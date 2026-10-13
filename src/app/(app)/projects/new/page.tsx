import { createClient } from "@/lib/supabase/server"
import { ProjectForm } from "@/app/(app)/projects/project-form"
import { createProjectAction } from "@/app/(app)/projects/actions"
import { getTimezoneOptions } from "@/lib/domain/timezones"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>
}) {
  const { clientId } = await searchParams
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("client_businesses")
    .select("id, display_name")
    .eq("status", "ACTIVE")
    .order("display_name", { ascending: true })

  const timezones = getTimezoneOptions()

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm
            action={createProjectAction}
            clients={clients ?? []}
            timezones={timezones}
            submitLabel="Create"
            defaultValues={clientId ? { clientBusinessId: clientId } : undefined}
          />
        </CardContent>
      </Card>
    </div>
  )
}
