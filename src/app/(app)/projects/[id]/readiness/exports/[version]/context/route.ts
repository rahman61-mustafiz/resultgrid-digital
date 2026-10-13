import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { loadExport } from "@/lib/export/load-export"

/**
 * H07: PROJECT_CONTEXT.md by itself -- the stored file, byte for byte, for
 * manual upload to ChatGPT or Claude.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const { id, version } = await params
  const loaded = await loadExport(await createClient(), id, version)
  if (!loaded) {
    return new NextResponse("Not found", { status: 404 })
  }

  return new NextResponse(loaded.row.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="PROJECT_CONTEXT.md"`,
      "X-Export-Package": loaded.packageName,
      "Cache-Control": "private, no-store",
    },
  })
}
