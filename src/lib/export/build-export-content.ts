import type { createClient } from "@/lib/supabase/server"
import { QUESTIONS } from "@/lib/questionnaire/v1"
import { computeReadiness, type AnswerRecord, type ReadinessResult } from "@/lib/questionnaire/readiness"
import {
  generateEvidenceIndexMarkdown,
  generateExportManifestMarkdown,
  generateProjectContextMarkdown,
  type EvidenceItemRow,
} from "@/lib/export/project-context"
import { exportPackageName } from "@/lib/export/package-name"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type ExportContentResult =
  | { error: string; content?: never }
  | {
      error: null
      content: string
      evidenceIndexContent: string
      exportManifestContent: string
      expectedVersion: number
      expectedFingerprint: string
      /** Readiness of exactly the answers this export was rendered from. */
      readiness: ReadinessResult
    }

type ExportSnapshot = {
  project: {
    id: string
    project_name: string
    project_type: string
    custom_type_label: string | null
    default_currency: string
    export_language: string
  }
  client: { display_name: string; record_type: string; country: string }
  answers: AnswerRecord[]
  evidence: (EvidenceItemRow & { verification_status: string; evidence_date: string | null })[]
  fingerprint: string
  next_version: number
}

/**
 * Renders the three export files from ONE consistent read
 * (get_project_export_snapshot), and computes readiness from that same
 * read, so the readiness the caller checks is the readiness of exactly the
 * content it stores. The returned version and fingerprint are
 * compare-and-swap arguments: the export RPCs recompute both under locks
 * and reject the write if anything changed since this read (see
 * supabase/migrations/20261006100000_export_content_fingerprint.sql).
 */
export async function buildExportContent(
  supabase: SupabaseServerClient,
  projectId: string
): Promise<ExportContentResult> {
  const { data, error } = await supabase.rpc("get_project_export_snapshot", {
    p_project_id: projectId,
  })

  if (error) {
    return { error: "Could not read the project for export." }
  }
  if (!data) {
    return { error: "Project not found." }
  }

  const snapshot = data as unknown as ExportSnapshot
  const project = snapshot.project
  const clientBusiness = snapshot.client
  const evidence = snapshot.evidence
  const expectedVersion = snapshot.next_version
  const generatedAtIso = new Date().toISOString()
  const exportVersion = `v${String(expectedVersion).padStart(2, "0")}`
  const answerRecords = snapshot.answers
  const readiness = computeReadiness(answerRecords, project.project_type)

  // This content is only ever stored as an APPROVED snapshot:
  // approve_and_export_project writes it in the same transaction that
  // approves the project, and record_project_export refuses unless the
  // project is APPROVED. When approving, the row read above still says
  // READY_FOR_REVIEW, which is not what the stored snapshot represents.
  const exportedProject = { ...project, readiness_status: "APPROVED" }

  const content = generateProjectContextMarkdown({
    project: exportedProject,
    clientBusiness,
    answers: answerRecords,
    generatedAtIso,
    exportVersion,
  })

  const evidenceIndexContent = generateEvidenceIndexMarkdown({
    project: exportedProject,
    evidence,
    generatedAtIso,
    exportVersion,
  })

  const excluded = new Set(readiness.notApplicable.map((q) => q.key))
  const answeredCount = answerRecords.filter(
    (a) =>
      !excluded.has(a.question_key) &&
      (a.status === "NOT_APPLICABLE" || ((a.status === "ANSWERED" || a.status === "CONFIRMED") && a.value !== null))
  ).length

  // Display timezone only (B08); not an export input, so not fingerprinted.
  const { data: workspace } = await supabase.from("workspaces").select("default_timezone").limit(1).maybeSingle()
  const packageName = exportPackageName({
    clientName: clientBusiness.display_name,
    projectName: project.project_name,
    generatedAtIso,
    version: expectedVersion,
    timeZone: workspace?.default_timezone || "Asia/Dhaka",
  })

  const exportManifestContent = generateExportManifestMarkdown({
    project: exportedProject,
    clientBusiness,
    generatedAtIso,
    exportVersion,
    packageName,
    answeredCount,
    applicableQuestionCount: QUESTIONS.length - excluded.size,
    excludedQuestionCount: excluded.size,
    evidenceCount: evidence.length,
  })

  return {
    error: null,
    content,
    evidenceIndexContent,
    exportManifestContent,
    expectedVersion,
    expectedFingerprint: snapshot.fingerprint,
    readiness,
  }
}
