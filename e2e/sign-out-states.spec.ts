import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test"

import { cleanupQa, createQaOwner, freshTotp, type QaOwner } from "./helpers/qa"

/**
 * Sign-out works in every auth state, not only from the app layout:
 * mid-enrollment (password accepted, no TOTP yet), pending TOTP
 * verification, and idle-locked. Each must end the session and land on
 * /login -- the proxy used to bounce these POSTs back to the state's page.
 * Signing in again afterwards must not inherit the old lock.
 */

test.describe.configure({ mode: "serial" })

const runId = `signout-${Date.now().toString(36)}`
let owner: QaOwner | null = null
let totpSecret = ""
const contexts: BrowserContext[] = []

async function newContext(browser: import("@playwright/test").Browser, phone = false) {
  const ctx = await browser.newContext(phone ? { ...devices["Pixel 7"] } : {})
  contexts.push(ctx)
  return ctx
}

async function passwordSignIn(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner!.email)
  await page.getByLabel("Password").fill(owner!.password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/login$/)
  for (const path of ["/dashboard", "/setup/totp", "/login/verify", "/lock"]) {
    await page.goto(path)
    await expect(page, `${path} after sign-out`).toHaveURL(/\/login$/)
  }
}

test.afterAll(async () => {
  for (const ctx of contexts) await ctx.close().catch(() => {})
  const report = await cleanupQa(owner, [])
  console.log("\nSign-out E2E cleanup report:", JSON.stringify(report, null, 2))
  expect(report.workspaceMembershipsRemaining).toBe(0)
  expect(report.mfaFactorsRemaining).toBe(0)
  expect(report.authUser, report.authUserDetail).not.toBe("NOT_DELETED")
})

test("1. sign out during TOTP enrollment", async ({ browser }) => {
  owner = await createQaOwner(runId)
  const page = await (await newContext(browser)).newPage()
  await passwordSignIn(page)
  await expect(page).toHaveURL(/\/setup\/totp$/)
  await page.getByRole("button", { name: "Sign out instead" }).click()
  await expectSignedOut(page)
})

test("2. sign out while TOTP verification is pending (on a phone)", async ({ browser }) => {
  // Enroll first, in its own context.
  const enrollPage = await (await newContext(browser)).newPage()
  await passwordSignIn(enrollPage)
  await expect(enrollPage).toHaveURL(/\/setup\/totp$/)
  const secretEl = enrollPage.locator("p.font-mono")
  await expect(secretEl).toBeVisible()
  totpSecret = (await secretEl.textContent())!.trim()
  await enrollPage.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await enrollPage.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(enrollPage).toHaveURL(/\/dashboard$/)

  const page = await (await newContext(browser, true)).newPage()
  await passwordSignIn(page)
  await expect(page).toHaveURL(/\/login\/verify$/)
  await page.getByRole("button", { name: "Sign out instead" }).click()
  await expectSignedOut(page)
})

test("3. sign out while idle-locked, and the next sign-in isn't locked", async ({ browser, baseURL }) => {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  await passwordSignIn(page)
  await expect(page).toHaveURL(/\/login\/verify$/)
  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Verify", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  // Test control: the state the proxy sets after 30 idle minutes.
  await ctx.addCookies([{ name: "rg_locked", value: "1", url: baseURL!, httpOnly: true, secure: true, sameSite: "Lax" }])
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/lock$/)
  await page.getByRole("button", { name: "Sign out instead" }).click()
  await expectSignedOut(page)
  expect((await ctx.cookies()).some((c) => c.name === "rg_locked"), "lock cookie cleared").toBe(false)

  await passwordSignIn(page)
  await expect(page, "a fresh sign-in goes to TOTP, not to the old lock").toHaveURL(/\/login\/verify$/)
  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Verify", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test("4. a cross-site sign-out request is refused", async ({ browser }) => {
  const ctx = await newContext(browser)
  const r = await ctx.request.post("/auth/sign-out", { headers: { origin: "https://evil.example" }, maxRedirects: 0 })
  expect(r.status()).toBe(403)
})
