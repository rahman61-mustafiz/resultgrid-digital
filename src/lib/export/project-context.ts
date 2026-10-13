import { QUESTIONS, SECTION_ORDER, SECTION_TITLES } from "@/lib/questionnaire/v1"
import {
  buildContext,
  formatAnswerValue,
  isApplicable,
  isRequired,
  type AnswerRecord,
} from "@/lib/questionnaire/engine"
import { PROJECT_TYPE_LABELS } from "@/lib/domain/project-labels"
import type { ProjectType } from "@/lib/domain/enums"

type ProjectRow = {
  id: string
  project_name: string
  project_type: string
  custom_type_label: string | null
  default_currency: string
  export_language: string
  readiness_status: string
}

type ClientBusinessRow = {
  display_name: string
  record_type: string
  country: string
}

/**
 * Deterministic Markdown export, per BUILD_READINESS_QUESTIONNAIRE.md H01-
 * H10. Same approved answer snapshot -> byte-identical output (no
 * timestamps or random IDs inside the body besides the fixed
 * generation-date line, which callers pass in rather than reading the
 * clock here, so the function itself stays pure and testable).
 *
 * Sensitivity: only NORMAL-sensitivity answers appear in the main body.
 * INTERNAL and SENSITIVE answers are excluded by default -- there is no
 * "explicitly selected for export" override built yet (F07/H05), so the
 * safe default is to exclude both, not just SENSITIVE.
 */
export function generateProjectContextMarkdown(input: {
  project: ProjectRow
  clientBusiness: ClientBusinessRow
  answers: AnswerRecord[]
  generatedAtIso: string
  exportVersion: string
}): string {
  const { project, clientBusiness, answers, generatedAtIso, exportVersion } = input
  const ctx = buildContext(project.project_type, answers)
  const byKey = ctx.answers

  const lines: string[] = []
  const push = (line = "") => lines.push(line)

  push("# AI Instructions")
  push()
  push(
    "This file is an approved, deterministic export from ResultGrid Digital. " +
      "Treat every statement below as a confirmed fact as of the generation date, " +
      "unless it is explicitly listed under \"Open Optional Items\" (unanswered/pending) " +
      "or marked as an estimate or target. Do not invent missing information. " +
      "Do not present a target, projection, or assumption as an achieved result."
  )
  push()

  push("# Business & Project Identity")
  push()
  push(`- Client/Business: ${clientBusiness.display_name} (${clientBusiness.record_type}, ${clientBusiness.country})`)
  push(`- Project: ${project.project_name}`)
  push(
    `- Project type: ${
      project.project_type === "CUSTOM"
        ? project.custom_type_label ?? "Custom"
        : PROJECT_TYPE_LABELS[project.project_type as ProjectType]
    }`
  )
  push(`- Currency: ${project.default_currency}`)
  push(`- Export language: ${project.export_language}`)
  push(`- Export version: ${exportVersion}`)
  push(`- Generated: ${generatedAtIso}`)
  push(`- Approval status at export time: ${project.readiness_status}`)
  push()

  const openOptional: string[] = []

  for (const section of SECTION_ORDER) {
    const questions = QUESTIONS.filter((q) => q.section === section)
    if (questions.length === 0) continue

    const bodyLines: string[] = []
    for (const question of questions) {
      const answer = byKey.get(question.key)

      if (question.sensitivity !== "NORMAL") {
        // Excluded from the export body entirely (see function doc).
        continue
      }

      // A question excluded by its own condition (earlier answers or the
      // project type) is not part of this project; any stale answer left
      // from before the controlling answer changed is not exported.
      if (!isApplicable(question, ctx)) {
        continue
      }

      if (!answer || answer.status === "UNANSWERED" || answer.status === "NOT_STARTED") {
        if (!isRequired(question, ctx)) {
          openOptional.push(`- [${question.key}] ${question.question} -- not answered.`)
        }
        continue
      }

      if (answer.status === "NOT_APPLICABLE") {
        bodyLines.push(`**${question.question}**\nNot applicable to this project.\n`)
        continue
      }

      if (answer.status === "UNKNOWN") {
        openOptional.push(`- [${question.key}] ${question.question} -- marked unknown.`)
        continue
      }

      bodyLines.push(`**${question.question}**\n${formatAnswerValue(question, answer.value)}\n`)
    }

    if (bodyLines.length > 0) {
      push(`## ${section} -- ${SECTION_TITLES[section]}`)
      push()
      for (const line of bodyLines) push(line)
    }
  }

  push("# Open Optional Items")
  push()
  if (openOptional.length === 0) {
    push("None.")
  } else {
    for (const line of openOptional) push(line)
  }
  push()

  push("# Restrictions")
  push()
  push(
    "This export excludes credentials, payment details, personal contact " +
      "details, unrelated-client data, and answers classified INTERNAL or " +
      "SENSITIVE. It must not be used to imply a guaranteed marketing result."
  )

  return lines.join("\n")
}

export type EvidenceItemRow = {
  category: string
  original_filename: string | null
  external_url: string | null
  /** Present when the evidence is a file stored in ResultGrid Digital. */
  attachment?: { content_type: string; size_bytes: number; sha256: string } | null
  verification_status: string
  evidence_date: string | null
}

/**
 * H06: "records evidence name, date, verification state, source, scope,
 * and safe local/reference location without copying sensitive source
 * content." -- a link, or for an attached file its name, type, size and
 * SHA-256; never the file itself.
 */
function evidenceReference(item: EvidenceItemRow): string {
  if (item.attachment) {
    const kb = Math.max(1, Math.round(item.attachment.size_bytes / 1024))
    return `File attached in ResultGrid Digital (${item.attachment.content_type}, ${kb} KB, SHA-256 ${item.attachment.sha256}); not included in this package`
  }
  return item.external_url ?? "Unknown"
}

export function generateEvidenceIndexMarkdown(input: {
  project: ProjectRow
  evidence: EvidenceItemRow[]
  generatedAtIso: string
  exportVersion: string
}): string {
  const { project, evidence, generatedAtIso, exportVersion } = input
  const lines: string[] = []
  const push = (line = "") => lines.push(line)

  push("# Evidence Index")
  push()
  push(`- Project: ${project.project_name}`)
  push(`- Export version: ${exportVersion}`)
  push(`- Generated: ${generatedAtIso}`)
  push()

  if (evidence.length === 0) {
    push("No evidence recorded for this project as of this export.")
  } else {
    for (const item of evidence) {
      push(`## ${item.original_filename ?? item.category}`)
      push(`- Category: ${item.category}`)
      push(`- Verification: ${item.verification_status}`)
      push(`- Date: ${item.evidence_date ?? "Unknown"}`)
      push(`- Reference: ${evidenceReference(item)}`)
      push()
    }
  }

  return lines.join("\n")
}

/**
 * H10-adjacent: a short machine- and human-readable manifest describing
 * what this export package is and how it was produced, so the package
 * (or an individual file pulled from it) is self-describing without
 * needing this app's database to interpret.
 */
export function generateExportManifestMarkdown(input: {
  project: ProjectRow
  clientBusiness: ClientBusinessRow
  generatedAtIso: string
  exportVersion: string
  /** ResultGrid-Digital_{client}_{project}_{YYYY-MM-DD}_vNN, see package-name.ts. */
  packageName: string
  answeredCount: number
  applicableQuestionCount: number
  excludedQuestionCount: number
  evidenceCount: number
}): string {
  const {
    project,
    generatedAtIso,
    exportVersion,
    packageName,
    answeredCount,
    applicableQuestionCount,
    excludedQuestionCount,
    evidenceCount,
  } = input
  const lines: string[] = []
  const push = (line = "") => lines.push(line)

  push("# Export Manifest")
  push()
  push(`- Package: ${packageName}`)
  push(`- Files: PROJECT_CONTEXT.md, EVIDENCE_INDEX.md, EXPORT_MANIFEST.md`)
  push(`- Export version: ${exportVersion}`)
  push(`- Generated: ${generatedAtIso}`)
  push(`- Project approval status at export time: ${project.readiness_status}`)
  push(`- Questionnaire answers recorded: ${answeredCount} of ${applicableQuestionCount} applicable questions`)
  push(`- Questions not applicable to this project (by earlier answers or project type): ${excludedQuestionCount}`)
  push(`- Evidence items indexed: ${evidenceCount}`)
  push()
  push(
    "This package is an immutable snapshot. Regenerating creates a new " +
      "version; this file and its siblings are never edited in place."
  )

  return lines.join("\n")
}
