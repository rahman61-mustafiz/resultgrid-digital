"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  correctionSchema,
  financialRecordSchema,
} from "@/lib/domain/financial-record"

export type FinancialRecordFormState = { error: string } | null

export async function addFinancialRecordAction(
  projectId: string,
  _prevState: FinancialRecordFormState,
  formData: FormData
): Promise<FinancialRecordFormState> {
  await assertEditingAllowed()
  const parsed = financialRecordSchema.safeParse({
    recordType: formData.get("recordType"),
    amount: formData.get("amount"),
    valueStatus: formData.get("valueStatus"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    evidenceStatus: formData.get("evidenceStatus"),
    evidenceUrl: formData.get("evidenceUrl") ?? "",
    notes: formData.get("notes") ?? "",
    attributedToMarketing: formData.get("attributedToMarketing") === "on",
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const v = parsed.data

  // The write and, if this project is currently APPROVED, its
  // invalidation happen together in one transaction -- financial data
  // feeds the client report shown through share links, so it needs the
  // same "APPROVED means nothing changed since approval" guarantee as
  // questionnaire answers and evidence. See
  // supabase/migrations/20260923100000_attribution_and_report_periods.sql.
  const { error } = await supabase.rpc("add_financial_record", {
    p_project_id: projectId,
    p_record_type: v.recordType,
    p_amount: v.amount,
    p_value_status: v.valueStatus,
    p_period_start: v.periodStart,
    p_period_end: v.periodEnd,
    p_evidence_status: v.evidenceStatus,
    p_evidence_url: v.evidenceUrl || undefined,
    p_notes: v.notes || undefined,
    p_attributed_to_marketing: v.attributedToMarketing,
  })

  if (error) {
    return { error: "Could not save this record." }
  }

  revalidatePath(`/projects/${projectId}/financials`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}

export type ImportRow = {
  recordType: string
  amount: number
  valueStatus: string
  periodStart: string
  periodEnd: string
  evidenceStatus: string
  evidenceUrl: string
  notes: string
  attributedToMarketing?: boolean
}

export type ImportResult = { error: string } | { error: null; imported: number }

/**
 * Inserts only rows that were already validated client-side against
 * financialRecordSchema (see the import page) -- the "reviewed CSV
 * import with preview, row validation, and explicit confirmation" flow
 * from CLAUDE_CODE_BUILD_HANDOFF.md. This is a second, server-side pass
 * of the same schema, not a trust boundary crossed on the client's say-so.
 */
export async function bulkImportFinancialRecordsAction(
  projectId: string,
  rows: ImportRow[]
): Promise<ImportResult> {
  await assertEditingAllowed()
  if (rows.length === 0) {
    return { error: "No valid rows to import." }
  }

  const supabase = await createClient()

  const validated: NonNullable<ReturnType<typeof financialRecordSchema.safeParse>["data"]>[] = []
  for (const row of rows) {
    const parsed = financialRecordSchema.safeParse(row)
    if (parsed.success) {
      validated.push(parsed.data)
    }
  }

  if (validated.length === 0) {
    return { error: "No valid rows to import." }
  }

  const { data: count, error } = await supabase.rpc("bulk_add_financial_records", {
    p_project_id: projectId,
    p_records: validated.map((v) => ({
      record_type: v.recordType,
      amount: v.amount,
      value_status: v.valueStatus,
      period_start: v.periodStart,
      period_end: v.periodEnd,
      evidence_status: v.evidenceStatus,
      evidence_url: v.evidenceUrl || null,
      notes: v.notes || null,
      attributed_to_marketing: v.attributedToMarketing ?? false,
    })),
  })

  if (error) {
    return { error: "Could not import these records." }
  }

  revalidatePath(`/projects/${projectId}/financials`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return { error: null, imported: count ?? validated.length }
}

export type AttributionFormState = { error: string } | null

/**
 * The supported edit path for adding evidence/attribution to a financial
 * record after it was first entered -- e.g. the Owner recorded client
 * revenue as OWNER_REPORTED/unattributed, then later obtained real
 * evidence and a confirmed marketing link. correct_financial_record only
 * ever touches amount (with its own correction-history trail); this is
 * the separate RPC for evidence/attribution fields, atomic with the same
 * approval-invalidation guarantee as every other financial write.
 */
export async function setFinancialRecordAttributionAction(
  recordId: string,
  projectId: string,
  _prevState: AttributionFormState,
  formData: FormData
): Promise<AttributionFormState> {
  await assertEditingAllowed()
  const evidenceUrl = (formData.get("evidenceUrl") as string | null)?.trim() ?? ""
  const attributedToMarketing = formData.get("attributedToMarketing") === "on"
  const evidenceStatus = (formData.get("evidenceStatus") as string | null) ?? "UNVERIFIED"

  if (attributedToMarketing && !evidenceUrl) {
    return { error: "An evidence link is required to attribute this revenue to marketing." }
  }
  if (attributedToMarketing && evidenceStatus === "UNVERIFIED") {
    return { error: "Set an evidence status other than Unverified before attributing this revenue." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_financial_record_attribution", {
    p_record_id: recordId,
    p_project_id: projectId,
    p_evidence_status: evidenceStatus,
    p_evidence_url: evidenceUrl || undefined,
    p_attributed_to_marketing: attributedToMarketing,
  })

  if (error) {
    return { error: "Could not save this. Check evidence status/link and try again." }
  }

  revalidatePath(`/projects/${projectId}/financials`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}

export type CorrectionFormState = { error: string } | null

export async function correctFinancialRecordAction(
  recordId: string,
  projectId: string,
  _prevState: CorrectionFormState,
  formData: FormData
): Promise<CorrectionFormState> {
  await assertEditingAllowed()
  const parsed = correctionSchema.safeParse({
    newAmount: formData.get("newAmount"),
    reason: formData.get("reason"),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("correct_financial_record", {
    p_record_id: recordId,
    p_project_id: projectId,
    p_new_amount: parsed.data.newAmount,
    p_reason: parsed.data.reason,
  })

  if (error) {
    return { error: "Could not save the correction." }
  }

  revalidatePath(`/projects/${projectId}/financials`)
  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}
