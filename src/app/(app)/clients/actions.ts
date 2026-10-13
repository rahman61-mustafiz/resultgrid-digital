"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { requireRecentReauth, RecentReauthRequiredError } from "@/lib/auth/reauth"
import { ruleErrorMessage } from "@/lib/domain/rule-errors"
import {
  clientBusinessSchema,
  normalizeOptional,
} from "@/lib/domain/client-business"

export type ClientBusinessFormState = { error: string } | null

function parseForm(formData: FormData) {
  return clientBusinessSchema.safeParse({
    displayName: formData.get("displayName"),
    recordType: formData.get("recordType"),
    country: formData.get("country"),
    timezone: formData.get("timezone"),
    legalName: formData.get("legalName") ?? "",
    website: formData.get("website") ?? "",
    industry: formData.get("industry") ?? "",
    primaryContactName: formData.get("primaryContactName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    internalNotes: formData.get("internalNotes") ?? "",
  })
}

export async function createClientBusinessAction(
  _prevState: ClientBusinessFormState,
  formData: FormData
): Promise<ClientBusinessFormState> {
  await assertEditingAllowed()
  const parsed = parseForm(formData)
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
  const { data, error } = await supabase
    .from("client_businesses")
    .insert({
      workspace_id: workspace.id,
      display_name: v.displayName,
      record_type: v.recordType,
      country: v.country,
      timezone: v.timezone,
      legal_name: normalizeOptional(v.legalName),
      website: normalizeOptional(v.website),
      industry: normalizeOptional(v.industry),
      primary_contact_name: normalizeOptional(v.primaryContactName),
      email: normalizeOptional(v.email),
      phone: normalizeOptional(v.phone),
      address: normalizeOptional(v.address),
      internal_notes: normalizeOptional(v.internalNotes),
    })
    .select("id")
    .single()

  if (error || !data) {
    return { error: "Could not create the client/business record." }
  }

  redirect(`/clients/${data.id}`)
}

export async function updateClientBusinessAction(
  id: string,
  _prevState: ClientBusinessFormState,
  formData: FormData
): Promise<ClientBusinessFormState> {
  await assertEditingAllowed()
  const parsed = parseForm(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const v = parsed.data

  // Client identity fields (name, type, country) are embedded in every
  // project under this client's PROJECT_CONTEXT.md -- update_client_
  // business_details does the write and invalidates every APPROVED
  // project under this client together in one transaction. See
  // supabase/migrations/20260922150000_atomic_mutation_invalidation.sql.
  const { error } = await supabase.rpc("update_client_business_details", {
    p_client_business_id: id,
    p_display_name: v.displayName,
    p_record_type: v.recordType,
    p_country: v.country,
    p_timezone: v.timezone,
    p_legal_name: normalizeOptional(v.legalName) ?? undefined,
    p_website: normalizeOptional(v.website) ?? undefined,
    p_industry: normalizeOptional(v.industry) ?? undefined,
    p_primary_contact_name: normalizeOptional(v.primaryContactName) ?? undefined,
    p_email: normalizeOptional(v.email) ?? undefined,
    p_phone: normalizeOptional(v.phone) ?? undefined,
    p_address: normalizeOptional(v.address) ?? undefined,
    p_internal_notes: normalizeOptional(v.internalNotes) ?? undefined,
  })

  if (error) {
    return { error: ruleErrorMessage(error, "Could not save changes.") }
  }

  redirect(`/clients/${id}`)
}

export type ClientActionState = { error: string } | null

// Archive/restore/delete go through RPCs that enforce B06/B07 (an archived
// client gets no new work; it can't be archived while it has ACTIVE or
// ON_HOLD projects; permanent deletion needs 30 days archived, no
// projects, the exact name, and a fresh password + TOTP sign-in). See
// supabase/migrations/20261008100000_lifecycle_archive_delete_rules.sql.
export async function archiveClientBusinessAction(id: string, reason: string): Promise<ClientActionState> {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { error } = await supabase.rpc("archive_client_business", {
    p_client_business_id: id,
    p_reason: reason.trim() || undefined,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not archive this record.") }
  }
  revalidatePath(`/clients/${id}`)
  return null
}

export async function restoreClientBusinessAction(id: string, reason: string): Promise<ClientActionState> {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_client_business", {
    p_client_business_id: id,
    p_reason: reason.trim() || undefined,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not restore this record.") }
  }
  revalidatePath(`/clients/${id}`)
  return null
}

export async function deleteClientBusinessPermanentlyAction(
  id: string,
  confirmName: string
): Promise<ClientActionState> {
  await assertEditingAllowed()
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
  const { error } = await supabase.rpc("delete_client_business_permanently", {
    p_client_business_id: id,
    p_confirm_name: confirmName,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not delete this record.") }
  }
  redirect("/clients")
}
