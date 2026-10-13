import JSZip from "jszip"

import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL, kindFromFilename, type AttachmentKind, type UploadCheck } from "@/lib/evidence/attachments"

/** Server-side byte checks for evidence attachments (see attachments.ts). */

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false
  return signature.every((b, i) => bytes[offset + i] === b)
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/**
 * The type the bytes actually are, or null when they're none of the
 * allowed types. DOCX and XLSX are both ZIP containers, told apart by
 * their main part.
 */
export async function detectKind(bytes: Uint8Array): Promise<AttachmentKind | null> {
  if (startsWith(bytes, ascii("%PDF-"))) return "pdf"
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg"
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp"
  if (startsWith(bytes, ascii("ftyp"), 4)) return "mp4"
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const zip = await JSZip.loadAsync(bytes)
      if (zip.file("word/document.xml")) return "docx"
      if (zip.file("xl/workbook.xml")) return "xlsx"
    } catch {
      return null
    }
    return null
  }
  return looksLikeCsv(bytes) ? "csv" : null
}

/** Text with no NUL bytes that decodes as UTF-8 (CSV has no signature). */
function looksLikeCsv(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 64 * 1024)
  if (sample.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length === bytes.length ? bytes : trimPartialUtf8(sample))
    return true
  } catch {
    return false
  }
}

/** A sample cut mid-character would fail strict decoding; drop the partial tail. */
function trimPartialUtf8(sample: Uint8Array): Uint8Array {
  let end = sample.length
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = sample[end - i]
    if ((b & 0xc0) === 0x80) continue
    if ((b & 0xc0) === 0xc0) end -= i
    break
  }
  return sample.subarray(0, end)
}

/** After upload: the stored bytes must be the type the extension claims. */
export async function verifyAttachmentBytes(filename: string, bytes: Uint8Array): Promise<UploadCheck> {
  const claimed = kindFromFilename(filename)
  if (!claimed) return { ok: false, error: "This file type isn't allowed." }
  if (bytes.length === 0) return { ok: false, error: "The file is empty." }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `Files over ${MAX_ATTACHMENT_LABEL} can't be attached.` }
  }
  const detected = await detectKind(bytes)
  if (detected !== claimed) {
    return {
      ok: false,
      error: `The file's contents aren't a ${ATTACHMENT_TYPES[claimed].label} file${
        detected ? ` (they look like ${ATTACHMENT_TYPES[detected].label})` : ""
      }. Check the file and try again.`,
    }
  }
  return { ok: true, kind: claimed, contentType: ATTACHMENT_TYPES[claimed].contentType }
}
