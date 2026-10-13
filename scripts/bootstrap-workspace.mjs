#!/usr/bin/env node
/**
 * One-time setup: creates the single Owner auth user (if missing), the
 * single workspace, and the Owner's workspace_members row.
 *
 * There is intentionally no in-app "create workspace" flow -- the MVP has
 * exactly one workspace (see BUILD_READINESS_QUESTIONNAIRE.md B01/C02),
 * created via this trusted, service-role script rather than through
 * RLS-gated end-user inserts.
 *
 * Usage:
 *   node --env-file=.env.local scripts/bootstrap-workspace.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
 * OWNER_EMAIL in the environment. Prompts for a password interactively
 * (never pass it as a CLI argument or env var) if the Owner user doesn't
 * exist yet.
 */
import { createClient } from "@supabase/supabase-js"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OWNER_EMAIL = process.env.OWNER_EMAIL
const WORKSPACE_NAME = process.env.WORKSPACE_NAME ?? "ResultGrid Digital"
const WORKSPACE_TIMEZONE = process.env.WORKSPACE_TIMEZONE ?? "Asia/Dhaka"

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  OWNER_EMAIL,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findOwnerUser() {
  // admin.auth.admin.listUsers paginates; the Owner is the only user in
  // this MVP so one page is enough in practice, but loop defensively.
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((u) => u.email === OWNER_EMAIL)
    if (found) return found
    if (data.users.length < 200) return null
    page += 1
  }
}

async function promptPassword() {
  const rl = createInterface({ input: stdin, output: stdout })
  const password = await rl.question(
    `No user found for ${OWNER_EMAIL}. Enter a password to create the Owner account: `
  )
  rl.close()
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.")
  }
  return password
}

async function main() {
  let owner = await findOwnerUser()

  if (!owner) {
    const password = await promptPassword()
    const { data, error } = await admin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password,
      email_confirm: true,
    })
    if (error) throw error
    owner = data.user
    console.log(`Created Owner auth user ${owner.id}.`)
  } else {
    console.log(`Found existing Owner auth user ${owner.id}.`)
  }

  const { data: existingWorkspace, error: findWorkspaceError } = await admin
    .from("workspaces")
    .select("id, name")
    .limit(1)
    .maybeSingle()
  if (findWorkspaceError) throw findWorkspaceError

  let workspaceId = existingWorkspace?.id
  if (!workspaceId) {
    const { data: workspace, error: createWorkspaceError } = await admin
      .from("workspaces")
      .insert({ name: WORKSPACE_NAME, default_timezone: WORKSPACE_TIMEZONE })
      .select("id")
      .single()
    if (createWorkspaceError) throw createWorkspaceError
    workspaceId = workspace.id
    console.log(`Created workspace "${WORKSPACE_NAME}" (${workspaceId}).`)
  } else {
    console.log(`Found existing workspace "${existingWorkspace.name}" (${workspaceId}).`)
  }

  const { data: existingMembership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", owner.id)
    .maybeSingle()

  if (!existingMembership) {
    const { error: membershipError } = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: owner.id, role: "OWNER" })
    if (membershipError) throw membershipError
    console.log("Created Owner workspace membership.")
  } else {
    console.log("Owner workspace membership already exists.")
  }

  console.log("\nNext step: sign in at /login, then complete mandatory TOTP enrollment.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
