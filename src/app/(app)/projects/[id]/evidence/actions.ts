"use server"

import { createHash } from "node:crypto"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { evidenceAttachmentSchema, evidenceItemSchema } from "@/lib/domain/evidence"
import { ruleErrorMessage } from "@/lib/domain/rule-errors"
import { checkUploadRequest } from "@/lib/evidence/attachments"
import { processStorageCleanup } from "@/lib/evidence/storage-cleanup"
import { verifyAttachmentBytes } from "@/lib/evidence/verify"

export type EvidenceFormState = { error: string } | null

const EVIDENCE_BUCKET = "evidence"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function revalidateEvidence(projectId: string) {
  revalidatePath(`/projects/${projectId}/evidence`)
  revalidatePath(`/projects/${projectId}/readiness`)
}

export async function addEvidenceItemAction(
  projectId: string,
  _prevState: EvidenceFormState,
  formData: FormData
): Promise<EvidenceFormState> {
  await assertEditingAllowed()
  const parsed = evidenceItemSchema.safeParse({
    category: formData.get("category"),
    originalFilename: formData.get("originalFilename") ?? "",
    externalUrl: formData.get("externalUrl"),
    verificationStatus: formData.get("verificationStatus"),
    evidenceDate: formData.get("evidenceDate") ?? "",
    notes: formData.get("notes") ?? "",
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const v = parsed.data

  // Evidence feeds EVIDENCE_INDEX.md in every export, so adding it must
  // invalidate an APPROVED project the same way a questionnaire edit
  // does -- add_evidence_item does the insert and that invalidation
  // together in one transaction. See
  // supabase/migrations/20260922150000_atomic_mutation_invalidation.sql.
  const { error } = await supabase.rpc("add_evidence_item", {
    p_project_id: projectId,
    p_category: v.category,
    p_original_filename: v.originalFilename || undefined,
    p_external_url: v.externalUrl,
    p_verification_status: v.verificationStatus,
    p_evidence_date: v.evidenceDate || undefined,
    p_notes: v.notes || undefined,
  })

  if (error) {
    return { error: ruleErrorMessage(error, "Could not save this evidence item.") }
  }

  revalidateEvidence(projectId)
  return null
}

export type PrepareUploadResult =
  | { error: string }
  | { error: null; uploadId: string; path: string; token: string; contentType: string }

/**
 * Step 1 of a file attachment. prepare_evidence_upload checks the Owner,
 * that the project is open for work and the name/size, records a pending
 * upload and generates its object path. Only then is a one-time signed
 * upload URL issued for that path. The browser uploads the file straight
 * to Storage; it never passes through this server.
 */
export async function prepareEvidenceUploadAction(
  projectId: string,
  filename: string,
  sizeBytes: number
): Promise<PrepareUploadResult> {
  await assertEditingAllowed()
  const check = checkUploadRequest(filename, sizeBytes)
  if (!check.ok) return { error: check.error }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("prepare_evidence_upload", {
    p_project_id: projectId,
    p_original_filename: filename,
    p_size_bytes: sizeBytes,
  })
  const prepared = data as { upload_id: string; storage_path: string; content_type: string } | null
  if (error || !prepared) {
    return { error: ruleErrorMessage(error, "Could not start this upload.") }
  }

  const { data: signed, error: signError } = await createAdminClient()
    .storage.from(EVIDENCE_BUCKET)
    .createSignedUploadUrl(prepared.storage_path)
  if (signError || !signed) {
    await discardUpload(prepared.upload_id, projectId, "upload URL not issued")
    return { error: "Could not start this upload." }
  }
  return {
    error: null,
    uploadId: prepared.upload_id,
    path: signed.path,
    token: signed.token,
    contentType: prepared.content_type,
  }
}

/** Gives up on an upload that failed its checks; its file is queued for deletion. */
async function discardUpload(uploadId: string, projectId: string, reason: string) {
  const { error } = await createAdminClient().rpc("discard_evidence_upload", {
    p_upload_id: uploadId,
    p_project_id: projectId,
    p_reason: reason,
  })
  if (error) {
    console.error(`evidence upload ${uploadId} was not discarded: ${error.message}`)
    return
  }
  await processStorageCleanup()
}

/**
 * Step 2, after the browser's upload. Acts only on a pending upload the
 * caller's own session can read (their upload, on this project). Downloads
 * the stored object, checks its bytes are the type the recorded file name
 * claims and hashes them; the result is recorded server-side
 * (record_evidence_upload_verification, service role only) and
 * add_evidence_attachment then records exactly what was verified.
 *
 * Failed byte checks discard the upload (never a recorded one: the
 * database refuses). Field errors and refusals from add_evidence_attachment
 * leave a verified upload in place to retry; an unfinished upload expires
 * after 24 hours. Finishing a recorded upload again is a no-op.
 */
export async function finalizeEvidenceUploadAction(
  projectId: string,
  uploadId: string,
  fields: {
    category: string
    verificationStatus: string
    evidenceDate: string
    notes: string
  }
): Promise<{ error: string | null }> {
  await assertEditingAllowed()
  if (!UUID.test(projectId) || !UUID.test(uploadId)) {
    return { error: "Unknown upload." }
  }
  const parsed = evidenceAttachmentSchema.safeParse(fields)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const v = parsed.data

  const supabase = await createClient()
  const { data: upload, error: uploadError } = await supabase
    .from("evidence_uploads")
    .select("id, status, storage_path, original_filename")
    .eq("id", uploadId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (uploadError || !upload) {
    return { error: "Unknown upload." }
  }
  if (upload.status === "RECORDED") {
    revalidateEvidence(projectId)
    return { error: null }
  }
  if (upload.status === "DISCARDED" || upload.status === "EXPIRED") {
    return { error: "This upload is no longer open. Upload the file again." }
  }

  if (upload.status === "PENDING") {
    const admin = createAdminClient()
    const { data: blob, error: downloadError } = await admin.storage.from(EVIDENCE_BUCKET).download(upload.storage_path)
    if (downloadError || !blob) {
      await discardUpload(uploadId, projectId, "file not received")
      return { error: "The upload didn't arrive. Try again." }
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const verified = await verifyAttachmentBytes(upload.original_filename, bytes)
    if (!verified.ok) {
      await discardUpload(uploadId, projectId, "failed the file type check")
      return { error: verified.error }
    }
    const { error: recordError } = await admin.rpc("record_evidence_upload_verification", {
      p_upload_id: uploadId,
      p_project_id: projectId,
      p_sha256: createHash("sha256").update(bytes).digest("hex"),
      p_size_bytes: bytes.length,
      p_content_type: verified.contentType,
    })
    if (recordError) {
      if (/does not match|was not found/.test(recordError.message)) {
        await discardUpload(uploadId, projectId, "stored file did not match the checked bytes")
        return { error: "The stored file didn't match what was checked. Upload it again." }
      }
      return { error: ruleErrorMessage(recordError, "Could not check this file.") }
    }
  }

  const { error } = await supabase.rpc("add_evidence_attachment", {
    p_project_id: projectId,
    p_upload_id: uploadId,
    p_category: v.category,
    p_verification_status: v.verificationStatus,
    p_evidence_date: v.evidenceDate || undefined,
    p_notes: v.notes || undefined,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not save this file.") }
  }

  revalidateEvidence(projectId)
  return { error: null }
}

/**
 * Evidence that is part of any export is kept (marked removed, file
 * retained); otherwise it is deleted, and the database queues its file for
 * deletion in the same transaction. See remove_evidence_item.
 */
export async function removeEvidenceItemAction(
  itemId: string,
  projectId: string,
  reason: string
): Promise<{ error: string | null; outcome?: "RETAINED" | "DELETED" }> {
  await assertEditingAllowed()
  if (reason.trim() === "") {
    return { error: "Give a reason for removing this evidence." }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("remove_evidence_item", {
    p_item_id: itemId,
    p_project_id: projectId,
    p_reason: reason,
  })
  if (error || !data) {
    return { error: ruleErrorMessage(error, "Could not remove this evidence item.") }
  }
  const result = data as { outcome: "RETAINED" | "DELETED" }
  if (result.outcome === "DELETED") {
    // A failure stays queued and shows on the evidence page.
    await processStorageCleanup()
  }
  revalidateEvidence(projectId)
  return { error: null, outcome: result.outcome }
}

/**
 * Retries queued file deletions (offered on the evidence page and in
 * Settings while any are open). The caller's own session must see the
 * project, or the workspace when no project is given.
 */
export async function retryStorageCleanupAction(projectId?: string): Promise<{ error: string | null }> {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { data: visible } = projectId
    ? await supabase.from("projects").select("id").eq("id", projectId).maybeSingle()
    : await supabase.from("workspaces").select("id").limit(1).maybeSingle()
  if (!visible) {
    return { error: "Not found." }
  }
  const run = await processStorageCleanup()
  if (projectId) revalidateEvidence(projectId)
  revalidatePath("/settings")
  return { error: run.failed > 0 ? "Some files still could not be deleted. They stay queued." : null }
}
