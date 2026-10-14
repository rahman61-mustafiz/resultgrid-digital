import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import { admin, cleanupQa, createQaOwner, freshTotp, type QaOwner } from "./helpers/qa"

/**
 * Forgot password (Rana, 14 October 2026): emailed link -> TOTP code -> new
 * password. The email itself isn't read: the link is made with the admin
 * API's generateLink (same token the email carries) and opened at
 * /auth/confirm, exactly as the email template builds it.
 */

test.describe.configure({ mode: "serial" })

const runId = `reset-${Date.now().toString(36)}`
const NEW_PASSWORD = `New-${runId}-Pass!9`
let owner: QaOwner | null = null
let totpSecret = ""
let context: BrowserContext
let page: Page

test.afterAll(async () => {
  await context?.close().catch(() => {})
  const report = await cleanupQa(owner, [])
  expect(report.workspaceMembershipsRemaining).toBe(0)
  expect(report.mfaFactorsRemaining).toBe(0)
})

async function signIn(p: Page, password: string) {
  await p.goto("/login")
  await p.getByLabel("Email").fill(owner!.email)
  await p.getByLabel("Password").fill(password)
  await p.getByRole("button", { name: "Sign in" }).click()
}

async function resetLink(baseURL: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: owner!.email,
    options: { redirectTo: `${baseURL}/reset-password` },
  })
  expect(error).toBeNull()
  const tokenHash = data.properties!.hashed_token
  return `/auth/confirm?token_hash=${tokenHash}&type=recovery&next=${encodeURIComponent(`${baseURL}/reset-password`)}`
}

test("1. set up an Owner with TOTP, then sign out", async ({ browser }) => {
  owner = await createQaOwner(runId)
  context = await browser.newContext()
  page = await context.newPage()
  await signIn(page, owner.password)
  await expect(page).toHaveURL(/\/setup\/totp$/)
  totpSecret = (await page.locator("p.font-mono").textContent())!.trim()
  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login/)
})

test("2. the login page links to the form, which answers the same for any address", async () => {
  await page.getByRole("link", { name: "Forgot password?" }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  const unknown = `nobody-${runId}@example.com`
  await page.getByLabel("Email").fill(unknown)
  await page.getByRole("button", { name: "Email me a reset link" }).click()
  await expect(page.getByTestId("reset-sent")).toBeVisible()
  const { count } = await admin
    .from("security_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "PASSWORD_RESET_REQUESTED")
    .filter("metadata->>emailAttempted", "eq", unknown)
  expect(count, "the request is in the audit log").toBe(1)
})

test("3. a bad link, or one pointing elsewhere, is refused", async ({ baseURL }) => {
  await page.goto(`/auth/confirm?token_hash=not-a-token&type=recovery&next=${encodeURIComponent(`${baseURL}/reset-password`)}`)
  await expect(page).toHaveURL(/\/forgot-password\?link=expired$/)
  await expect(page.getByTestId("reset-link-problem")).toBeVisible()

  await page.goto(`/auth/confirm?token_hash=x&type=recovery&next=${encodeURIComponent("https://evil.example/steal")}`)
  await expect(page).toHaveURL(/\/forgot-password\?link=invalid$/)
})

test("4. the link alone isn't enough: the TOTP code comes before the new password", async ({ baseURL }) => {
  await page.goto(await resetLink(baseURL!))
  await expect(page).toHaveURL(/\/login\/verify$/)
  // Skipping the code doesn't reach the form.
  await page.goto("/reset-password")
  await expect(page).toHaveURL(/\/login\/verify$/)

  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).toHaveURL(/\/reset-password$/)

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel("Confirm new password").fill(`${NEW_PASSWORD}x`)
  await page.getByRole("button", { name: "Set new password" }).click()
  await expect(page.locator('form [role="alert"]')).toHaveText("Passwords don't match.")

  // The form clears after a refused submit.
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD)
  await page.getByRole("button", { name: "Set new password" }).click()
  await expect(page).toHaveURL(/\/dashboard\?password=reset$/)

  const { count } = await admin
    .from("security_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "PASSWORD_RESET_COMPLETED")
    .eq("user_id", owner!.userId)
  expect(count).toBe(1)
})

test("5. the old password stops working and the new one works", async ({ browser }) => {
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login/)
  await signIn(page, owner!.password)
  await expect(page.locator('form [role="alert"]')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)

  await signIn(page, NEW_PASSWORD)
  await expect(page).toHaveURL(/\/login\/verify$/)
  owner!.password = NEW_PASSWORD

  // A normal sign-in carrying a forged reset cookie still can't use the form.
  const other = await browser.newContext()
  const p = await other.newPage()
  await signIn(p, NEW_PASSWORD)
  await p.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await p.getByRole("button", { name: "Verify" }).click()
  await expect(p).toHaveURL(/\/dashboard$/)
  const host = new URL(p.url()).hostname
  await other.addCookies([{ name: "rg_password_reset", value: new Date().toISOString(), domain: host, path: "/" }])
  await p.goto("/reset-password")
  await expect(p.getByTestId("reset-not-verified")).toBeVisible()
  await expect(p.getByLabel("New password", { exact: true })).toHaveCount(0)
  await other.close()
})
