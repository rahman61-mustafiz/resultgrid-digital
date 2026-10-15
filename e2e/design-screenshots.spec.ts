import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test"

import { cleanupQa, createQaOwner, freshTotp, type QaOwner } from "./helpers/qa"

/**
 * Screenshots of the "sky" design for review, not
 * assertions about it: login, dashboard and a list page on desktop, the
 * dashboard on a phone, and a client share page. Written to
 * test-results/design/. Runs only when asked:
 *
 *   RG_SCREENSHOTS=1 npx playwright test e2e/design-screenshots.spec.ts
 */

test.skip(!process.env.RG_SCREENSHOTS, "set RG_SCREENSHOTS=1 to capture design screenshots")
test.describe.configure({ mode: "serial" })

const OUT = "test-results/design"
let owner: QaOwner | null = null
let context: BrowserContext
let page: Page

test.afterAll(async () => {
  await context?.close().catch(() => {})
  const report = await cleanupQa(owner, [])
  expect(report.workspaceMembershipsRemaining).toBe(0)
})

test("desktop pages", async ({ browser }) => {
  owner = await createQaOwner(`design-${Date.now().toString(36)}`)
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  await page.goto("/login")
  await page.screenshot({ path: `${OUT}/login-desktop.png` })
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/setup\/totp$/)
  await page.screenshot({ path: `${OUT}/totp-setup-desktop.png` })
  const secret = (await page.locator("p.font-mono").textContent())!.trim()
  await page.getByLabel("Authenticator code").fill(await freshTotp(secret))
  await page.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.screenshot({ path: `${OUT}/dashboard-desktop.png`, fullPage: true })
  await page.goto("/clients")
  await page.screenshot({ path: `${OUT}/clients-desktop.png` })
  await page.goto("/settings")
  await page.screenshot({ path: `${OUT}/settings-desktop.png` })

  const phone = await browser.newContext({ ...devices["Pixel 7"], storageState: await context.storageState() })
  const phonePage = await phone.newPage()
  await phonePage.goto("/dashboard")
  await phonePage.screenshot({ path: `${OUT}/dashboard-phone.png`, fullPage: true })
  await phone.close()

  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const sharePage = await anon.newPage()
  await sharePage.goto("/share/not-a-real-token")
  await sharePage.screenshot({ path: `${OUT}/share-desktop.png` })
  await anon.close()
})
