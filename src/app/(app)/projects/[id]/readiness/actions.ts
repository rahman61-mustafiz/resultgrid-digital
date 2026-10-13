"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireRecentReauth, RecentReauthRequiredError } from "@/lib/auth/reauth"
import { buildExportContent } from "@/lib/export/build-export-content"
import { ruleErrorMessage } from "@/lib/domain/rule-errors"

export type ReadinessActionState = { error: string } | null

// PT409 (HTTP 409): the project changed between the snapshot this action checked
// and the write (see supabase/migrations/20261006100000_export_content_fingerprint.sql,
// 20261006120000, 20261007110000).
function exportErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "PT409") {
    return "The project changed while this was being checked. Review the latest data and try again."
  }
  return error.message
}

function incompleteMessage(problemCount: number): string {
  return `${problemCount} question(s) are missing or invalid. See the list above.`
}

export async function markReadyForReviewAction(
  projectId: string
): Promise<ReadinessActionState> {
  await assertEditingAllowed()
  const supabase = await createClient()

  // Readiness is computed from the same one-read snapshot approval uses,
  // and its fingerprint is passed to the RPC, which re-verifies it under
  // lock: an answer saved after this check makes the transition fail
  // (PT409) instead of marking a now-invalid project ready.
  const snapshot = await buildExportContent(supabase, projectId)
  if (snapshot.error !== null) {
    return { error: snapshot.error }
  }
  if (!snapshot.readiness.isComplete) {
    return { error: incompleteMessage(snapshot.readiness.problems.length) }
  }

  // The status transition and its ledger entry happen together inside one
  // DB transaction, with the actor and timestamp assigned by the function
  // itself (auth.uid()/now()), never passed in -- direct writes to
  // projects.readiness_status and project_approval_events are revoked for
  // the authenticated role, so this RPC is the only path. See
  // supabase/migrations/20260922120000_approval_ledger_hardening.sql and
  // 20261007110000_submit_for_review_fingerprint.sql.
  const { error } = await supabase.rpc("submit_project_for_review", {
    p_project_id: projectId,
    p_expected_fingerprint: snapshot.expectedFingerprint,
  })

  if (error) {
    return { error: exportErrorMessage(error) }
  }

  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}

export async function approveAndExportProjectAction(
  projectId: string,
  approvalNote: string
): Promise<ReadinessActionState> {
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

  // Readiness is checked on the same snapshot the export is rendered from,
  // and the RPC rejects the write if that snapshot is no longer current
  // (fingerprint), so what is approved is exactly what was checked.
  const built = await buildExportContent(supabase, projectId)
  if (built.error !== null) {
    return { error: built.error }
  }
  if (!built.readiness.isComplete) {
    return { error: incompleteMessage(built.readiness.problems.length) }
  }

  // Approval and the immutable export snapshot it approves are created
  // together, in one transaction -- APPROVED never exists as a bare
  // status disconnected from a specific project_exports row.
  const { error } = await supabase.rpc("approve_and_export_project", {
    p_project_id: projectId,
    p_content: built.content,
    p_evidence_index_content: built.evidenceIndexContent,
    p_export_manifest_content: built.exportManifestContent,
    p_expected_version: built.expectedVersion,
    p_expected_fingerprint: built.expectedFingerprint,
    p_approval_note: approvalNote.trim() || undefined,
  })

  if (error) {
    return { error: exportErrorMessage(error) }
  }

  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}

/**
 * Re-exports an already-APPROVED project without changing its status --
 * e.g. to get a fresh timestamped copy to re-send. Since any
 * export-relevant edit invalidates APPROVED back to READY_FOR_REVIEW (see
 * upsert_project_answer/add_evidence_item/delete_evidence_item/
 * update_project_details/update_client_business_details in
 * supabase/migrations/20260922150000_atomic_mutation_invalidation.sql),
 * staying APPROVED here guarantees nothing changed since the original
 * approval, so this can never disagree with what was approved.
 */
export async function generateAdditionalExportAction(
  projectId: string
): Promise<ReadinessActionState> {
  await assertEditingAllowed()
  const supabase = await createClient()

  const built = await buildExportContent(supabase, projectId)
  if (built.error !== null) {
    return { error: built.error }
  }
  if (!built.readiness.isComplete) {
    return { error: incompleteMessage(built.readiness.problems.length) }
  }

  const { error } = await supabase.rpc("record_project_export", {
    p_project_id: projectId,
    p_content: built.content,
    p_evidence_index_content: built.evidenceIndexContent,
    p_export_manifest_content: built.exportManifestContent,
    p_expected_version: built.expectedVersion,
    p_expected_fingerprint: built.expectedFingerprint,
  })

  if (error) {
    return { error: exportErrorMessage(error) }
  }

  revalidatePath(`/projects/${projectId}/readiness`)
  return null
}

/**
 * H09: an export can be archived (and restored), never deleted. Archived
 * exports stay downloadable; archiving only moves them out of the main
 * list. Each change is an append-only event (set_export_archived).
 */
export async function setExportArchivedAction(
  projectId: string,
  exportId: string,
  archived: boolean,
  reason: string
): Promise<{ error: string | null }> {
  await assertEditingAllowed()
  if (reason.trim() === "") {
    return { error: `Give a reason for ${archived ? "archiving" : "restoring"} this export.` }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_export_archived", {
    p_export_id: exportId,
    p_archived: archived,
    p_reason: reason,
  })
  if (error) {
    return { error: ruleErrorMessage(error, "Could not update this export.") }
  }
  revalidatePath(`/projects/${projectId}/readiness`)
  return { error: null }
}
