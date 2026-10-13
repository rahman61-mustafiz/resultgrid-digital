"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getProjectWorkspaceId } from "@/lib/domain/project"
import { creativeEditSchema, creativeIntakeSchema } from "@/lib/domain/creative"
import type { CreativeStatus } from "@/lib/domain/enums"

export type CreativeFormState = { error: string } | null

export async function createCreativeAction(
  projectId: string,
  _prevState: CreativeFormState,
  formData: FormData
): Promise<CreativeFormState> {
  await assertEditingAllowed()
  const parsed = creativeIntakeSchema.safeParse({
    title: formData.get("title"),
    channel: formData.get("channel") ?? "",
    format: formData.get("format") ?? "",
    plannedDate: formData.get("plannedDate") ?? "",
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const workspaceId = await getProjectWorkspaceId(supabase, projectId)
  if (!workspaceId) {
    return { error: "Project not found." }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const v = parsed.data
  const { data, error } = await supabase
    .from("creatives")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title: v.title,
      channel: v.channel || null,
      format: v.format || null,
      planned_date: v.plannedDate || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()

  if (error || !data) {
    return { error: "Could not create this creative." }
  }

  redirect(`/projects/${projectId}/creatives/${data.id}`)
}

/**
 * Editing copy/asset_url bumps the version, appends the PREVIOUS state to
 * version_history, and -- if the creative was APPROVED or PUBLISHED --
 * invalidates that approval by moving status back to CHANGES_REQUESTED
 * and clearing approved_at/approved_by. This matches
 * CLAUDE_CODE_BUILD_HANDOFF.md "Editing an approved version creates a new
 * version and invalidates the previous approval for publication."
 */
export async function updateCreativeContentAction(
  creativeId: string,
  projectId: string,
  _prevState: CreativeFormState,
  formData: FormData
): Promise<CreativeFormState> {
  await assertEditingAllowed()
  const parsed = creativeEditSchema.safeParse({
    copy: formData.get("copy") ?? "",
    assetUrl: formData.get("assetUrl") ?? "",
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("creatives")
    .select("copy, asset_url, version, version_history, status")
    .eq("id", creativeId)
    .maybeSingle()

  if (!existing) {
    return { error: "Creative not found." }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const history = Array.isArray(existing.version_history) ? existing.version_history : []
  const nextHistory = [
    ...history,
    {
      version: existing.version,
      copy: existing.copy,
      asset_url: existing.asset_url,
      changed_at: new Date().toISOString(),
      changed_by: user?.id ?? null,
    },
  ]

  const wasApproved = existing.status === "APPROVED" || existing.status === "PUBLISHED"

  const { error } = await supabase
    .from("creatives")
    .update({
      copy: parsed.data.copy || null,
      asset_url: parsed.data.assetUrl || null,
      version: existing.version + 1,
      version_history: nextHistory,
      ...(wasApproved
        ? { status: "CHANGES_REQUESTED", approved_at: null, approved_by: null, approval_note: null }
        : {}),
    })
    .eq("id", creativeId)

  if (error) {
    return { error: "Could not save changes." }
  }

  revalidatePath(`/projects/${projectId}/creatives/${creativeId}`)
  return null
}

export async function updateCreativeStatusAction(
  creativeId: string,
  projectId: string,
  formData: FormData
) {
  await assertEditingAllowed()
  const status = formData.get("status") as CreativeStatus | null
  const note = (formData.get("approvalNote") as string | null)?.trim() ?? ""

  if (!status) {
    throw new Error("Choose a status.")
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from("creatives")
    .update(
      status === "APPROVED"
        ? {
            status,
            approved_at: new Date().toISOString(),
            approved_by: user?.id ?? null,
            approval_note: note || null,
          }
        : { status }
    )
    .eq("id", creativeId)
  if (error) {
    throw new Error("Could not update status.")
  }

  revalidatePath(`/projects/${projectId}/creatives/${creativeId}`)
  revalidatePath(`/projects/${projectId}/creatives`)
}
