/**
 * Evidence file attachments (spec F06, J01): PDF, DOCX, XLSX, CSV, PNG,
 * JPG/JPEG, WEBP and short MP4, checked by BOTH extension and detected
 * content. Anything else -- or a file whose bytes don't match its
 * extension -- is refused. Files above MAX_ATTACHMENT_BYTES stay Drive
 * links (J01's 1 GB linked-file policy); the `evidence` Storage bucket
 * enforces the same limit and types itself
 * (supabase/migrations/20261009150000_evidence_attachments_retention.sql).
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENT_LABEL = "25 MB"

export type AttachmentKind = "pdf" | "docx" | "xlsx" | "csv" | "png" | "jpeg" | "webp" | "mp4"

export const ATTACHMENT_TYPES: Record<AttachmentKind, { extensions: string[]; contentType: string; label: string }> = {
  pdf: { extensions: ["pdf"], contentType: "application/pdf", label: "PDF" },
  docx: {
    extensions: ["docx"],
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word (DOCX)",
  },
  xlsx: {
    extensions: ["xlsx"],
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel (XLSX)",
  },
  csv: { extensions: ["csv"], contentType: "text/csv", label: "CSV" },
  png: { extensions: ["png"], contentType: "image/png", label: "PNG" },
  jpeg: { extensions: ["jpg", "jpeg"], contentType: "image/jpeg", label: "JPEG" },
  webp: { extensions: ["webp"], contentType: "image/webp", label: "WEBP" },
  mp4: { extensions: ["mp4"], contentType: "video/mp4", label: "MP4" },
}

export const ACCEPT_ATTRIBUTE = Object.values(ATTACHMENT_TYPES)
  .flatMap((t) => t.extensions.map((e) => `.${e}`))
  .join(",")

export function kindFromFilename(filename: string): AttachmentKind | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim())
  if (!match) return null
  const ext = match[1].toLowerCase()
  for (const [kind, t] of Object.entries(ATTACHMENT_TYPES) as [AttachmentKind, (typeof ATTACHMENT_TYPES)[AttachmentKind]][]) {
    if (t.extensions.includes(ext)) return kind
  }
  return null
}

export type UploadCheck = { ok: true; kind: AttachmentKind; contentType: string } | { ok: false; error: string }

/** Before an upload URL is issued: the name and size the browser reports. */
export function checkUploadRequest(filename: string, sizeBytes: number): UploadCheck {
  const kind = kindFromFilename(filename)
  if (!kind) {
    return { ok: false, error: "This file type isn't allowed. Use PDF, DOCX, XLSX, CSV, PNG, JPG, WEBP or MP4, or add a Drive link." }
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "The file is empty." }
  }
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `Files over ${MAX_ATTACHMENT_LABEL} can't be attached: store it in Drive and add the link instead.` }
  }
  return { ok: true, kind, contentType: ATTACHMENT_TYPES[kind].contentType }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
