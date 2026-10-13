import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Downloads an evidence attachment. Access is decided by reading the
 * evidence row with the caller's own session (RLS: workspace members only);
 * only then is a 60-second signed URL issued for that one object, served
 * as a download (Content-Disposition: attachment), never inline. Removed
 * evidence stays downloadable: it is retained history.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params
  const supabase = await createClient()

  const { data: item } = await supabase
    .from("evidence_items")
    .select("storage_path, original_filename")
    .eq("id", itemId)
    .eq("project_id", id)
    .maybeSingle()

  if (!item?.storage_path) {
    return new NextResponse("Not found", { status: 404 })
  }

  const { data, error } = await createAdminClient()
    .storage.from("evidence")
    .createSignedUrl(item.storage_path, 60, { download: item.original_filename ?? true })
  if (error || !data) {
    return new NextResponse("This file is not available.", { status: 502 })
  }

  const response = NextResponse.redirect(data.signedUrl, 303)
  response.headers.set("cache-control", "no-store")
  return response
}
