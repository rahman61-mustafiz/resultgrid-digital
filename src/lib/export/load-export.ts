import type { createClient } from "@/lib/supabase/server"
import { exportPackageName, packageNameFromManifest } from "@/lib/export/package-name"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * One stored export, read with the caller's session (RLS decides access),
 * plus its package name: the one recorded in its manifest when it has the
 * current format, otherwise computed from the current names, the
 * generation time and the workspace timezone (exports made before names
 * were recorded).
 */
export async function loadExport(supabase: SupabaseServerClient, projectId: string, version: string) {
  const versionNumber = Number(version)
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return null

  const { data: row } = await supabase
    .from("project_exports")
    .select("id, version, content, evidence_index_content, export_manifest_content, generated_at, projects(project_name, client_businesses(display_name))")
    .eq("project_id", projectId)
    .eq("version", versionNumber)
    .maybeSingle()
  if (!row) return null

  let packageName = packageNameFromManifest(row.export_manifest_content)
  if (!packageName) {
    const { data: workspace } = await supabase.from("workspaces").select("default_timezone").limit(1).maybeSingle()
    packageName = exportPackageName({
      clientName: row.projects?.client_businesses?.display_name ?? "Client",
      projectName: row.projects?.project_name ?? "Project",
      generatedAtIso: row.generated_at,
      version: row.version,
      timeZone: workspace?.default_timezone || "Asia/Dhaka",
    })
  }
  return { row, packageName }
}
