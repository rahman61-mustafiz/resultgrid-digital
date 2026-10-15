/**
 * DEVELOPMENT ONLY: give the dev Owner a new password and remove its TOTP
 * factor, so the next sign-in at http://localhost:3000 enrolls a fresh
 * authenticator entry. For when the dev password or authenticator entry is
 * lost (14 October 2026: the dev factor from 21 September no longer matched).
 *
 *   node --env-file=.env.local scripts/dev-reset-owner.mjs
 *
 * Refuses anything but a localhost APP_URL, and refuses the staging and
 * production projects outright. The new password is typed here, hidden, and
 * never printed or logged.
 */
import { createInterface } from "node:readline"
import { stdin, stdout } from "node:process"
import { createClient } from "@supabase/supabase-js"

const NOT_DEV_REFS = ["ixfsyzzdetqpuekxwoxz", "hsexcnknowjzgebxgevg"] // staging, production

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const appUrl = process.env.APP_URL ?? ""
const email = process.env.OWNER_EMAIL ?? ""
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

function fail(message) {
  console.error(`Refusing: ${message}`)
  process.exit(1)
}

if (!url || !serviceKey || !email) fail("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OWNER_EMAIL must be set (use --env-file=.env.local).")
if (NOT_DEV_REFS.some((ref) => url.includes(ref))) fail("this is the staging or production project. This script is for development only.")
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appUrl)) fail(`APP_URL is ${appUrl || "(unset)"}, not a localhost address. This script is for development only.`)

/** Reads a line without echoing it. */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) stdout.write(s)
    }
    rl.question(prompt, (answer) => {
      rl.close()
      stdout.write("\n")
      resolve(answer)
    })
  })
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listError) fail(`could not list users: ${listError.message}`)
const user = list.users.find((u) => u.email === email)
if (!user) fail(`no account for ${email} in this project.`)

console.log(`Development project: ${new URL(url).host}`)
console.log(`Account: ${email}`)
const password = await askHidden("New dev password (at least 8 characters, hidden): ")
if (password.length < 8) fail("the password must be at least 8 characters.")
const again = await askHidden("Type it again: ")
if (again !== password) fail("the two entries don't match.")

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password })
if (updateError) fail(`could not set the password: ${updateError.message}`)

const { data: factors, error: factorError } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
if (factorError) fail(`password set, but could not list authenticator factors: ${factorError.message}`)
for (const f of factors.factors) {
  const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id })
  if (error) fail(`password set, but could not remove factor ${f.id}: ${error.message}`)
}

console.log(`Done: new password set, ${factors.factors.length} authenticator factor(s) removed.`)
console.log("Next: sign in at http://localhost:3000/login and scan the new QR code (it shows as \"ResultGrid (dev)\").")
