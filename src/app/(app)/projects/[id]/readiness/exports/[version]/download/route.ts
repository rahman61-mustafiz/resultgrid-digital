import { NextResponse } from "next/server"
import JSZip from "jszip"

import { createClient } from "@/lib/supabase/server"
import { loadExport } from "@/lib/export/load-export"

/** The complete package (H07): the three stored files, unchanged, as a ZIP named after the package. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const { id, version } = await params
  const loaded = await loadExport(await createClient(), id, version)
  if (!loaded) {
    return new NextResponse("Not found", { status: 404 })
  }
  const { row, packageName } = loaded

  const zip = new JSZip()
  zip.file("PROJECT_CONTEXT.md", row.content)
  zip.file("EVIDENCE_INDEX.md", row.evidence_index_content)
  zip.file("EXPORT_MANIFEST.md", row.export_manifest_content)
  const zipBytes = await zip.generateAsync({ type: "uint8array" })

  return new NextResponse(new Blob([new Uint8Array(zipBytes)]), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${packageName}.zip"`,
      "Cache-Control": "private, no-store",
    },
  })
}
