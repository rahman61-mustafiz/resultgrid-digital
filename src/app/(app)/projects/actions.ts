"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { processStorageCleanup } from "@/lib/evidence/storage-cleanup"
import { requireRecentReauth, RecentReauthRequiredError } from "@/lib/auth/reauth"
import { projectCreateSchema, projectDetailsSchema, parseTags } from "@/lib/domain/project"
import { ruleErrorMessage } from "@/lib/domain/rule-errors"
import type { ProjectLifecycleStatus } from "@/lib/domain/enums"

export type ProjectFormState = { error: string } | null
export type ProjectActionState = { error: string } | null

function detailsFromForm(formData: FormData) {
  return {
    projectName: formData.get("projectName"),
    projectType: formData.get("projectType"),
    customTypeLabel: formData.get("customTypeLabel") ?? "",
    defaultCurrency: formData.get("defaultCurrency"),
    exportLanguage: formData.get("exportLanguage") || "en",
    timezone: formData.get("timezone"),
    startDate: formData.get("startDate") ?? "",
    targetCompletionDate: formData.get("targetCompletionDate") ?? "",
    shortDescription: formData.get("shortDescription") ?? "",
    internalNotes: formData.get("internalNotes") ?? "",
    tags: formData.get("tags") ?? "",
  }
}

function normalizeOptional(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null
}

export async function createProjectAction(
  _prevState: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  await assertEditingAllowed()
  const parsed = projectCreateSchema.safeParse({
    clientBusinessId: formData.get("clientBusinessId"),
    ...detailsFromForm(formData),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .single()
  if (!workspace) {
    return { error: "No workspace found for this account." }
  }

  const v = parsed.data
  // A new project always starts ACTIVE + INCOMPLETE under an ACTIVE
  // client; the projects_enforce_new trigger rejects anything else.
  const { data, error } = await supabase
    .from("projects")
    .insert({
      workspace_id: workspace.id,
      client_business_id: v.clientBusinessId,
      project_name: v.projectName,
      project_type: v.projectType,
      custom_type_label:
        v.projectType === "CUSTOM" ? normalizeOptional(v.customTypeLabel) : null,
      lifecycle_status: "ACTIVE",
      default_currency: v.defaultCurrency,
      export_language: v.exportLanguage,
      timezone: v.timezone,
      start_date: normalizeOptional(v.startDate),
      target_completion_date: normalizeOptional(v.targetCompletionDate),
      short_description: normalizeOptional(v.shortDescription),
      internal_notes: normalizeOptional(v.internalNotes),
      tags: parseTags(v.tags),
    })
    .select("id")
    .single()

  if (error || !data) {
    return { error: ruleErrorMessage(error, "Could not create the project.") }
  }

  redirect(`/projects/${data.id}`)
}

export async function updateProjectAction(
  id: string,
  _prevState: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  await assertEditingAllowed()
  const parsed = projectDetailsSchema.safeParse(detailsFromForm(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const v = parsed.data

  // Project identity fields (name, type, currency, ...) are embedded in
  // PROJECT_CONTEXT.md -- update_project_details does the write and, if
  // this project is currently APPROVED, its invalidation together in one
  // transaction. It cannot change the client (B05) or the lifecycle (see
  // setProjectLifecycleAction). See
  // supabase/migrations/20260922150000_atomic_mutation_invalidation.sql and
  // 20261008100000_lifecycle_archive_delete_rules.sql.
  const { error } = await supabase.rpc("update_project_details", {
    p_project_id: id,
    p_project_name: v.projectName,
    p_project_type: v.projectType,
    p_custom_type_label:
      v.projectType === "CUSTOM" ? (normalizeOptional(v.customTypeLabel) ?? undefined) : undefined,
    p_default_currency: v.defaultCurrency,
    p_export_language: v.exportLanguage,
    p_timezone: v.timezone,
    p_start_date: normalizeOptional(v.startDate) ?? undefined,
    p_target_completion_date: normalizeOptional(v.targetCompletionDate) ?? undefined,
    p_short_description: normalizeOptional(v.shortDescription) ?? undefined,
    p_internal_notes: normalizeOptional(v.internalNotes) ?? undefined,
    p_tags: parseTags(v.tags),
  })

  if (error) {
    return { error: ruleErrorMessage(error, "Could not save changes.") }
  }

  redirect(`/projects/${id}`)
}

export async function setProjectLifecycleAction(
  projectId: string,
  toStatus: ProjectLifecycleStatus,
  reason: string
): Promise<ProjectActionState> {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_project_lifecycle", {
    p_project_id: projectId,
    p_to_status: toStatus,
    p_reason: reason.trim() || undefined,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not change the project status.") }
  }
  revalidatePath(`/projects/${projectId}`)
  return null
}

export async function restoreProjectAction(projectId: string, reason: string): Promise<ProjectActionState> {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_project", {
    p_project_id: projectId,
    p_reason: reason.trim() || undefined,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not restore the project.") }
  }
  revalidatePath(`/projects/${projectId}`)
  return null
}

export async function deleteProjectPermanentlyAction(
  projectId: string,
  confirmName: string
): Promise<ProjectActionState> {
  await assertEditingAllowed()
  // Checked again inside delete_project_permanently from the token's amr
  // claims; this gives the clear message before the call.
  try {
    await requireRecentReauth()
  } catch (e) {
    if (e instanceof RecentReauthRequiredError) {
      return {
        error:
          "This requires a fresh password + TOTP sign-in within the last 5 minutes. Sign out and back in, then try again.",
      }
    }
    throw e
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_project_permanently", {
    p_project_id: projectId,
    p_confirm_name: confirmName,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not delete the project.") }
  }
  // The deletion queued the project's evidence files (and any open
  // uploads) in the same transaction; a failure here stays queued.
  await processStorageCleanup()
  redirect("/projects")
}
