import { expect, test } from "@playwright/test"
import JSZip from "jszip"

import { MAX_ATTACHMENT_BYTES, checkUploadRequest, kindFromFilename } from "@/lib/evidence/attachments"
import { detectKind, verifyAttachmentBytes } from "@/lib/evidence/verify"
import { exportDate, exportPackageName, packageNameFromManifest, sanitizeNamePart } from "@/lib/export/package-name"

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)))

const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
)
const PDF = bytes("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n%%EOF\n")
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF", [0, 1])
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ")
const MP4 = bytes([0, 0, 0, 0x18], "ftypmp42", [0, 0, 0, 0], "mp42isom")
const CSV = bytes("date,amount\n2026-10-01,1200\n2026-10-02,950\n")

async function office(part: string) {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", "<Types/>")
  zip.file(part, "<x/>")
  return zip.generateAsync({ type: "uint8array" })
}

test.describe("evidence attachments (spec F06/J01)", () => {
  test("the extension decides the claimed type; others are refused before upload", () => {
    expect(kindFromFilename("Report.PDF")).toBe("pdf")
    expect(kindFromFilename("photo.jpeg")).toBe("jpeg")
    expect(kindFromFilename("photo.jpg")).toBe("jpeg")
    for (const name of ["script.exe", "page.html", "archive.zip", "image.svg", "doc.doc", "noextension"]) {
      expect(checkUploadRequest(name, 10).ok, name).toBe(false)
    }
    expect(checkUploadRequest("a.pdf", 0).ok).toBe(false)
    expect(checkUploadRequest("a.pdf", MAX_ATTACHMENT_BYTES).ok).toBe(true)
    const tooBig = checkUploadRequest("a.mp4", MAX_ATTACHMENT_BYTES + 1)
    expect(tooBig.ok).toBe(false)
    expect(!tooBig.ok && tooBig.error).toContain("Drive")
  })

  test("each allowed type is detected from its bytes", async () => {
    expect(await detectKind(PNG)).toBe("png")
    expect(await detectKind(PDF)).toBe("pdf")
    expect(await detectKind(JPEG)).toBe("jpeg")
    expect(await detectKind(WEBP)).toBe("webp")
    expect(await detectKind(MP4)).toBe("mp4")
    expect(await detectKind(CSV)).toBe("csv")
    expect(await detectKind(await office("word/document.xml"))).toBe("docx")
    expect(await detectKind(await office("xl/workbook.xml"))).toBe("xlsx")
  })

  test("bytes that don't match the extension are refused", async () => {
    const renamed = await verifyAttachmentBytes("statement.pdf", PNG)
    expect(renamed.ok).toBe(false)
    expect(!renamed.ok && renamed.error).toContain("aren't a PDF file (they look like PNG)")
    expect((await verifyAttachmentBytes("sheet.xlsx", await office("word/document.xml"))).ok).toBe(false)
    expect((await verifyAttachmentBytes("data.csv", PNG)).ok, "binary data is not CSV").toBe(false)
    expect((await verifyAttachmentBytes("data.csv", bytes([0xff, 0xfe, 0x00, 0x41]))).ok, "not UTF-8 text").toBe(false)
    const plainZip = new JSZip()
    plainZip.file("readme.txt", "hello")
    expect((await verifyAttachmentBytes("doc.docx", await plainZip.generateAsync({ type: "uint8array" }))).ok).toBe(false)
    expect((await verifyAttachmentBytes("empty.png", new Uint8Array())).ok).toBe(false)
  })

  test("matching bytes pass with the canonical content type", async () => {
    const png = await verifyAttachmentBytes("screenshot.png", PNG)
    expect(png).toEqual({ ok: true, kind: "png", contentType: "image/png" })
    const docx = await verifyAttachmentBytes("brief.docx", await office("word/document.xml"))
    expect(docx.ok && docx.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  })
})

test.describe("export package names (spec H01/H08)", () => {
  test("names are reduced to safe ASCII", () => {
    expect(sanitizeNamePart("Vera Wellness & Spa (Dhaka)", "X")).toBe("Vera-Wellness-Spa-Dhaka")
    expect(sanitizeNamePart("Café Ünïcode", "X")).toBe("Cafe-Unicode")
    expect(sanitizeNamePart("সুন্দর", "Client")).toBe("Client")
    expect(sanitizeNamePart("a".repeat(100), "X")).toHaveLength(60)
  })

  test("the date is the generation date in the workspace timezone", () => {
    expect(exportDate("2026-10-09T19:30:00Z", "Asia/Dhaka")).toBe("2026-10-10")
    expect(exportDate("2026-10-09T17:30:00Z", "Asia/Dhaka")).toBe("2026-10-09")
  })

  test("the package name has the spec's shape and round-trips through the manifest", () => {
    const name = exportPackageName({
      clientName: "Vera Wellness",
      projectName: "Launch / Q4",
      generatedAtIso: "2026-10-09T19:30:00Z",
      version: 3,
      timeZone: "Asia/Dhaka",
    })
    expect(name).toBe("ResultGrid-Digital_Vera-Wellness_Launch-Q4_2026-10-10_v03")
    expect(packageNameFromManifest(`# Export Manifest\n\n- Package: ${name}\n- Files: x`)).toBe(name)
    expect(packageNameFromManifest("- Package: ResultGrid-Digital_Vera Wellness_Launch_v01"), "older manifests").toBeNull()
  })
})
