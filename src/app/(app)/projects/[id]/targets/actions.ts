"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { targetSchema } from "@/lib/domain/target"

export type TargetFormState = { error: string } | null

export async function addTargetAction(
  projectId: string,
  _prevState: TargetFormState,
  formData: FormData
): Promise<TargetFormState> {
  await assertEditingAllowed()
  const parsed = targetSchema.safeParse({
    metric: formData.get("metric"),
    unit: formData.get("unit"),
    baseline: formData.get("baseline"),
    target: formData.get("target"),
    actual: formData.get("actual"),
    actualSource: formData.get("actualSource") ?? "",
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    notes: formData.get("notes") ?? "",
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const v = parsed.data

  // Targets feed the client report the same way financial records do --
  // the write and any resulting invalidation happen together. See
  // supabase/migrations/20260923100000_attribution_and_report_periods.sql.
  const { error } = await supabase.rpc("add_project_target", {
    p_project_id: projectId,
    p_metric: v.metric,
    p_unit: v.unit,
    p_target: v.target,
    p_period_start: v.periodStart,
    p_period_end: v.periodEnd,
    p_baseline: v.baseline ?? undefined,
    p_actual: v.actual ?? undefined,
    p_actual_source: v.actualSource || undefined,
    p_notes: v.notes || undefined,
  })

  if (error) {
    return { error: "Could not save this target." }
  }

  revalidatePath(`/projects/${projectId}/targets`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}

export async function updateActualAction(
  targetId: string,
  projectId: string,
  formData: FormData
) {
  await assertEditingAllowed()
  const raw = formData.get("actual")
  const actual =
    typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_project_target_actual", {
    p_target_id: targetId,
    p_project_id: projectId,
    p_actual: actual ?? undefined,
  })

  if (error) {
    throw new Error("Could not update the actual value.")
  }

  revalidatePath(`/projects/${projectId}/targets`)
  revalidatePath(`/projects/${projectId}/readiness`)
}
