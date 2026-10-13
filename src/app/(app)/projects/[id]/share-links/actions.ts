"use server"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getProjectWorkspaceId } from "@/lib/domain/project"
import {
  DEFAULT_SHARE_LINK_EXPIRY_DAYS,
  generatePin,
  generateShareToken,
  hashPin,
} from "@/lib/domain/share-link"

export type CreateShareLinkResult = { error: string } | { error: null; token: string; pin: string }

export async function createShareLinkAction(
  projectId: string
): Promise<CreateShareLinkResult> {
  await assertEditingAllowed()
  const supabase = await createClient()
  const workspaceId = await getProjectWorkspaceId(supabase, projectId)
  if (!workspaceId) {
    return { error: "Project not found." }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const token = generateShareToken()
  const pin = generatePin()
  const expiresAt = new Date(
    Date.now() + DEFAULT_SHARE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error } = await supabase.from("client_share_links").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    token,
    pin_hash: hashPin(pin, token),
    expires_at: expiresAt,
    created_by: user?.id ?? null,
  })

  if (error) {
    return { error: "Could not create the share link." }
  }

  revalidatePath(`/projects/${projectId}/share-links`)
  // The PIN is only ever known at creation time (only its hash is stored)
  // -- this is the one moment the caller can show it to the Owner.
  return { error: null, token, pin }
}

export async function revokeShareLinkAction(linkId: string, projectId: string) {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { error } = await supabase
    .from("client_share_links")
    // Also clear any active session nonce so an already-PIN-verified
    // viewer (cookie still in their browser) loses access immediately
    // instead of only new PIN attempts being blocked.
    .update({
      revoked_at: new Date().toISOString(),
      session_nonce_hash: null,
      session_nonce_expires_at: null,
    })
    .eq("id", linkId)

  if (error) {
    throw new Error("Could not revoke this link.")
  }
  revalidatePath(`/projects/${projectId}/share-links`)
}

export async function extendShareLinkAction(linkId: string, projectId: string) {
  await assertEditingAllowed()
  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("client_share_links")
    .select("expires_at")
    .eq("id", linkId)
    .maybeSingle()

  if (!existing) {
    throw new Error("Link not found.")
  }

  const base = new Date(
    Math.max(new Date(existing.expires_at).getTime(), Date.now())
  )
  const nextExpiry = new Date(
    base.getTime() + DEFAULT_SHARE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error } = await supabase
    .from("client_share_links")
    .update({ expires_at: nextExpiry, revoked_at: null })
    .eq("id", linkId)

  if (error) {
    throw new Error("Could not extend this link.")
  }
  revalidatePath(`/projects/${projectId}/share-links`)
}
