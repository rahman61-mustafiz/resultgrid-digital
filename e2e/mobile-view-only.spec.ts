import { devices, expect, request, test, type BrowserContext, type Page } from "@playwright/test"

import {
  admin,
  cleanupQa,
  createQaOwner,
  freshTotp,
  QA_CLIENT_PREFIX,
  signInAtAal2,
  type QaOwner,
} from "./helpers/qa"

/**
 * Spec A07/I08: on a phone the Owner can sign in (password + TOTP) and view
 * the dashboard, projects and reports, but cannot edit anything. Checked
 * in a real browser emulating a Pixel 7 (Android Chrome, the spec's mobile
 * target) against the production build, including that the server -- not
 * just the disabled UI -- refuses phone writes.
 */

test.describe.configure({ mode: "serial" })

const runId = `mobile-${Date.now().toString(36)}`
const clientName = `${QA_CLIENT_PREFIX}${runId}`
const projectName = `Mobile View QA ${runId}`
const ANSWER_KEY = "E01.Q01"
const SEEDED_ANSWER = `Mobile QA brand ${runId}`
const VIEW_ONLY_TEXT = "Editing is desktop-only in this release."

let owner: QaOwner | null = null
let totpSecret = ""
let projectId = ""
const createdClientIds: string[] = []
let phone: BrowserContext
let page: Page

async function storedAnswer() {
  const { data } = await admin
    .from("project_answers")
    .select("value")
    .eq("project_id", projectId)
    .eq("question_key", ANSWER_KEY)
    .single()
  return data?.value
}

test.afterAll(async () => {
  await phone?.close().catch(() => {})
  const report = await cleanupQa(owner, createdClientIds)
  console.log("\nMobile E2E cleanup report:", JSON.stringify(report, null, 2))
  if (report.authUser === "SOFT_DELETED") {
    console.log(`NOTE (reported separately, not a clean delete): QA auth user ${owner?.userId} ${report.authUserDetail}`)
  }
  expect(report.qaClientsRemaining).toBe(0)
  expect(report.qaProjectsRemaining).toBe(0)
  expect(report.workspaceMembershipsRemaining).toBe(0)
  expect(report.mfaFactorsRemaining).toBe(0)
  expect(report.authUser, report.authUserDetail).not.toBe("NOT_DELETED")
})

test("1. on a phone the Owner signs in and enrolls TOTP", async ({ browser }) => {
  owner = await createQaOwner(runId)
  phone = await browser.newContext({ ...devices["Pixel 7"] })
  page = await phone.newPage()

  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/setup\/totp$/)

  const secretEl = page.locator("p.font-mono")
  await expect(secretEl).toBeVisible()
  totpSecret = (await secretEl.textContent())!.trim()
  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByTestId("mobile-view-only")).toContainText(VIEW_ONLY_TEXT)
})

test("2. seed a project to view (desktop-side, through the app's RPCs)", async () => {
  const seed = await signInAtAal2(owner!, totpSecret)
  const { data: ws } = await admin.from("workspaces").select("id").limit(1).single()
  const { data: cb, error: cbError } = await seed
    .from("client_businesses")
    .insert({ workspace_id: ws!.id, display_name: clientName, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  expect(cbError).toBeNull()
  createdClientIds.push(cb!.id)
  const { data: project, error: projectError } = await seed
    .from("projects")
    .insert({ workspace_id: ws!.id, client_business_id: cb!.id, project_name: projectName, project_type: "SEO", lifecycle_status: "ACTIVE", default_currency: "BDT", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  expect(projectError).toBeNull()
  projectId = project!.id
  const { error: answerError } = await seed.rpc("upsert_project_answer", {
    p_project_id: projectId,
    p_question_key: ANSWER_KEY,
    p_questionnaire_version: 1,
    p_status: "ANSWERED",
    p_value: SEEDED_ANSWER,
    p_next_readiness_status: "INCOMPLETE",
  })
  expect(answerError).toBeNull()
})

test("3. the phone can view the dashboard, clients, project, questionnaire and report", async () => {
  for (const [path, text] of [
    ["/dashboard", "Dashboard"],
    ["/clients", clientName],
    ["/projects", projectName],
    [`/projects/${projectId}`, projectName],
    [`/projects/${projectId}/reports`, null],
    [`/projects/${projectId}/financials`, null],
    ["/settings/audit", null],
  ] as const satisfies readonly (readonly [string, string | null])[]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    if (text) await expect(page.getByText(text).first(), path).toBeVisible()
    await expect(page.getByTestId("mobile-view-only"), path).toBeVisible()
  }
  await page.goto(`/projects/${projectId}/questionnaire`)
  const field = page.locator(`[id="q-${ANSWER_KEY}"]`)
  await expect(field).toHaveValue(SEEDED_ANSWER)
  await expect(field, "questionnaire fields are disabled on a phone").toBeDisabled()
  await expect(page.getByRole("button", { name: "Sign out" }), "sign-out sits outside the disabled content").toBeEnabled()
})

test("4. the server refuses phone edits even when the UI is bypassed", async () => {
  // Turn the page's view-only guard off and re-enable the field, as someone
  // poking at the DOM could, and edit: the Server Action POST must be
  // refused by the server.
  await page.goto(`/projects/${projectId}/questionnaire`)
  const field = page.locator(`[id="q-${ANSWER_KEY}"]`)
  await expect(field).toBeDisabled()
  await page.evaluate(() => {
    const root = document.querySelector("[data-testid=view-only-content]")!
    root.removeAttribute("data-view-only")
    root.querySelectorAll("textarea, input").forEach((el) => ((el as HTMLInputElement).disabled = false))
  })
  await expect(field).toBeEnabled()
  await field.fill(`Changed on a phone ${runId}`)
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]),
    field.blur(),
  ])
  expect(response.status(), "Server Action POST from a phone").toBe(403)
  await expect(page.locator("div.border-b", { has: field }).getByRole("alert")).toContainText("Not saved")
  expect(await storedAnswer(), "the stored answer is unchanged").toBe(SEEDED_ANSWER)

  // Any other write from the phone's session, on any app path, is refused too.
  for (const path of [`/projects/${projectId}`, "/clients/new", "/settings", `/projects/${projectId}/readiness/exports/1/download`]) {
    const r = await phone.request.post(path, { headers: { "next-action": "0000" }, data: "[]", maxRedirects: 0 })
    expect(r.status(), `POST ${path}`).toBe(403)
    expect(await r.text(), `POST ${path}`).toContain(VIEW_ONLY_TEXT)
  }

  // iOS Safari sends no client hints: the User-Agent alone must classify it.
  const iphone = await request.newContext({
    baseURL: test.info().project.use.baseURL,
    userAgent: devices["iPhone 15"].userAgent,
    storageState: await phone.storageState(),
  })
  const ios = await iphone.post(`/projects/${projectId}/questionnaire`, { headers: { "next-action": "0000" }, data: "[]", maxRedirects: 0 })
  expect(ios.status(), "POST with an iPhone User-Agent and no client hints").toBe(403)
  await iphone.dispose()
})

test("5. the phone can sign out", async () => {
  await page.goto("/dashboard")
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login$/)
})
