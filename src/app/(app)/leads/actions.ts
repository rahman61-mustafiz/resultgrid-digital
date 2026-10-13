"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  leadIntakeSchema,
  normalizeEmail,
  normalizePhone,
} from "@/lib/domain/lead"
import type { LeadStage } from "@/lib/domain/enums"
import { ruleErrorMessage } from "@/lib/domain/rule-errors"

export type DuplicateLead = { id: string; name: string; stage: string }

export type CreateLeadState = {
  error: string | null
  duplicates?: DuplicateLead[]
  /** Preserves what was typed so the form doesn't empty out after a duplicate warning. */
  submitted?: Record<string, string>
} | null

export async function createLeadAction(
  _prevState: CreateLeadState,
  formData: FormData
): Promise<CreateLeadState> {
  await assertEditingAllowed()
  const parsed = leadIntakeSchema.safeParse({
    name: formData.get("name"),
    businessName: formData.get("businessName") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    serviceNeeded: formData.get("serviceNeeded") ?? "",
    budget: formData.get("budget") ?? "",
    consent: formData.get("consent") === "on",
    source: formData.get("source") ?? "",
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  if (!parsed.data.consent) {
    return { error: "Consent is required before this lead can be recorded." }
  }

  const supabase = await createClient()
  const { data: workspace } = await supabase.from("workspaces").select("id").single()
  if (!workspace) {
    return { error: "No workspace found for this account." }
  }

  const v = parsed.data
  const normalizedPhone = normalizePhone(v.phone)
  const normalizedEmail = normalizeEmail(v.email)
  const force = formData.get("force") === "true"

  if (!force) {
    const orFilters: string[] = []
    if (normalizedPhone) orFilters.push(`normalized_phone.eq.${normalizedPhone}`)
    if (normalizedEmail) orFilters.push(`normalized_email.eq.${normalizedEmail}`)

    if (orFilters.length > 0) {
      const { data: existing } = await supabase
        .from("leads")
        .select("id, name, stage")
        .or(orFilters.join(","))

      if (existing && existing.length > 0) {
        return {
          error: null,
          duplicates: existing,
          submitted: {
            name: v.name,
            businessName: v.businessName ?? "",
            phone: v.phone ?? "",
            email: v.email ?? "",
            serviceNeeded: v.serviceNeeded ?? "",
            budget: v.budget ?? "",
            source: v.source ?? "",
          },
        }
      }
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      workspace_id: workspace.id,
      name: v.name,
      business_name: v.businessName || null,
      phone: v.phone || null,
      normalized_phone: normalizedPhone,
      email: v.email || null,
      normalized_email: normalizedEmail,
      service_needed: v.serviceNeeded || null,
      budget: v.budget || null,
      consent: v.consent,
      source: v.source || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()

  if (error || !created) {
    return { error: "Could not create this lead." }
  }

  redirect(`/leads/${created.id}`)
}

export type StageActionState = { error: string } | null

export async function updateLeadStageAction(
  leadId: string,
  _prevState: StageActionState,
  formData: FormData
): Promise<StageActionState> {
  await assertEditingAllowed()
  const stage = formData.get("stage") as LeadStage | null
  const reason = (formData.get("qualificationReason") as string | null)?.trim() ?? ""

  if (!stage) {
    return { error: "Choose a stage." }
  }
  if ((stage === "QUALIFIED" || stage === "LOST") && reason.length < 3) {
    return { error: "A short reason is required for this stage change." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      stage,
      qualification_reason: reason || null,
    })
    .eq("id", leadId)

  if (error) {
    return { error: ruleErrorMessage(error, "Could not update this lead.") }
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  return null
}

export async function logFollowupAction(leadId: string) {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { data: lead } = await supabase
    .from("leads")
    .select("followup_count")
    .eq("id", leadId)
    .single()

  if (!lead) {
    throw new Error("Lead not found.")
  }

  const { error } = await supabase
    .from("leads")
    .update({
      followup_count: lead.followup_count + 1,
      last_followup_at: new Date().toISOString(),
    })
    .eq("id", leadId)

  if (error) {
    throw new Error("Could not log follow-up.")
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
}

/** Archive or restore a lead; both need a reason (set_lead_archived). */
export async function setLeadArchivedAction(
  leadId: string,
  archived: boolean,
  reason: string
): Promise<{ error: string | null }> {
  await assertEditingAllowed()
  if (reason.trim() === "") {
    return { error: `Give a reason for ${archived ? "archiving" : "restoring"} this lead.` }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_lead_archived", {
    p_lead_id: leadId,
    p_archived: archived,
    p_reason: reason,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not update this lead.") }
  }
  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  revalidatePath("/dashboard")
  return { error: null }
}
