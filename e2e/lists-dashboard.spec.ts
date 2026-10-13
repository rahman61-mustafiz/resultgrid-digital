import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { admin, cleanupQa, createQaOwner, freshTotp, purgeQaLeads, QA_CLIENT_PREFIX, signInAtAal2, type QaOwner } from "./helpers/qa"

/**
 * Priority #10 (BUILD_READINESS_QUESTIONNAIRE.md I02-I04, I08, M07):
 * navigation, list search/filter/sort/archive, and the dashboard's
 * project/period filters, previous-period comparison, truthfulness
 * warnings, target progress and card settings -- in a real browser
 * against the production build and the dev database. Synthetic QA data
 * only; assertions are scoped to this run's records.
 */

test.describe.configure({ mode: "serial" })

const runId = `lists-${Date.now().toString(36)}`
const name = (s: string) => `${QA_CLIENT_PREFIX}${runId} ${s}`
const ALPHA = name("Alpha 50%_off")
const GAMMA = name("Gamma 50ABoff") // matches 50%_off only if the wildcards weren't escaped
const BETA = name("Beta, Ltd.")
const PROJECT = `Lists QA ${runId} Launch`
const LEAD_KEEP = name("lead Rahim")
const LEAD_ARCHIVE = name("lead Karim")
const NOTE = `lists-note-${runId}`

let owner: QaOwner | null = null
let totpSecret = ""
let seed: SupabaseClient
let desktop: BrowserContext
let page: Page
let projectId = ""
const clientIds: string[] = []
const leadIds: string[] = []

/** YYYY-MM-DD in Asia/Dhaka (the workspace timezone). */
function dhaka(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}
const today = dhaka(new Date())
const [Y, M] = today.split("-").map(Number)
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const thisMonth1 = iso(Y, M, 1)
const lastMonth1 = iso(Y, M - 1, 1)
const lastMonth20 = iso(Y, M - 1, 20)

test.afterAll(async () => {
  await desktop?.close().catch(() => {})
  const leadsLeft = await purgeQaLeads(leadIds)
  const { error: prefsError } = owner ? await admin.from("dashboard_preferences").delete().eq("user_id", owner.userId) : { error: null }
  expect(prefsError).toBeNull()
  const report = await cleanupQa(owner, clientIds)
  console.log("\nLists/dashboard E2E cleanup report:", JSON.stringify({ ...report, leadsLeft }, null, 2))
  expect(leadsLeft).toBe(0)
  expect(report.qaClientsRemaining).toBe(0)
  expect(report.qaProjectsRemaining).toBe(0)
  expect(report.workspaceMembershipsRemaining).toBe(0)
  expect(report.mfaFactorsRemaining).toBe(0)
  expect(report.authUser, report.authUserDetail).not.toBe("NOT_DELETED")
})

test("1. sign in, enroll TOTP, and seed QA data through the app's RPCs", async ({ browser }) => {
  owner = await createQaOwner(runId)
  desktop = await browser.newContext()
  page = await desktop.newPage()
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/setup\/totp$/)
  totpSecret = (await page.locator("p.font-mono").textContent())!.trim()
  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  seed = await signInAtAal2(owner, totpSecret)
  const { data: ws } = await admin.from("workspaces").select("id").limit(1).single()
  for (const displayName of [ALPHA, GAMMA, BETA]) {
    const { data, error } = await seed
      .from("client_businesses")
      .insert({ workspace_id: ws!.id, display_name: displayName, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka" })
      .select("id")
      .single()
    expect(error).toBeNull()
    clientIds.push(data!.id)
  }
  expect((await seed.rpc("archive_client_business", { p_client_business_id: clientIds[2], p_reason: "QA archived" })).error).toBeNull()

  const { data: project, error: projectError } = await seed
    .from("projects")
    .insert({ workspace_id: ws!.id, client_business_id: clientIds[0], project_name: PROJECT, project_type: "SEO", lifecycle_status: "ACTIVE", default_currency: "BDT", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  expect(projectError).toBeNull()
  projectId = project!.id

  const record = (type: string, amount: number, status: string, start: string, end: string) =>
    seed.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: type,
      p_amount: amount,
      p_value_status: status,
      p_period_start: start,
      p_period_end: end,
      p_evidence_status: "OWNER_REPORTED",
      p_notes: NOTE,
      p_attributed_to_marketing: false,
    })
  for (const [type, amount, status, start, end] of [
    ["CLIENT_PAYMENT_RECEIVED", 5000, "CONFIRMED", thisMonth1, thisMonth1],
    ["DIRECT_DELIVERY_COST", 1200, "ESTIMATED", thisMonth1, thisMonth1],
    ["CLIENT_PAYMENT_RECEIVED", 700, "PENDING", thisMonth1, thisMonth1],
    ["CLIENT_PAYMENT_RECEIVED", 4000, "CONFIRMED", lastMonth1, lastMonth1],
    ["MARKETING_SPEND", 900, "CONFIRMED", lastMonth20, thisMonth1],
  ] as const) {
    const { error } = await record(type, amount, status, start, end)
    expect(error, `${type} ${status}`).toBeNull()
  }
  const { data: target, error: targetError } = await seed.rpc("add_project_target", {
    p_project_id: projectId,
    p_metric: "LEADS",
    p_unit: "count",
    p_target: 20,
    p_period_start: thisMonth1,
    p_period_end: iso(Y, M + 1, 0),
  })
  expect(targetError).toBeNull()
  const targetId = (Array.isArray(target) ? target[0] : target)?.id
  expect((await seed.rpc("update_project_target_actual", { p_target_id: targetId, p_project_id: projectId, p_actual: 5 })).error).toBeNull()
  expect(
    (await seed.rpc("add_evidence_item", { p_project_id: projectId, p_category: "reports", p_external_url: `https://example.com/${runId}/report`, p_verification_status: "OWNER_REPORTED", p_notes: NOTE })).error
  ).toBeNull()

  for (const leadName of [LEAD_KEEP, LEAD_ARCHIVE]) {
    const { data, error } = await seed
      .from("leads")
      .insert({ workspace_id: ws!.id, name: leadName, email: `${leadName.split(" ").pop()!.toLowerCase()}-${runId}@example.com`, consent: true, stage: "NEW" })
      .select("id")
      .single()
    expect(error).toBeNull()
    leadIds.push(data!.id)
  }
})

test("2. navigation has every spec section, and each page loads", async () => {
  await page.goto("/dashboard")
  const nav = page.getByRole("navigation", { name: "Primary" })
  for (const label of ["Dashboard", "Clients", "Projects", "Leads", "Reports", "Files", "Exports", "Settings"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible()
  }
  for (const [label, heading] of [
    ["Reports", "Reports"],
    ["Files", "Files & evidence"],
    ["Exports", "Exports"],
  ] as const) {
    await nav.getByRole("link", { name: label, exact: true }).click()
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible()
  }
})

test("3. client search is literal; archived clients are filtered", async () => {
  await page.goto("/clients")
  const list = page.getByTestId("client-list")
  await page.getByLabel(/Name, legal name/).fill("50%_off")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(list).toContainText(ALPHA)
  await expect(list, "% and _ are literal, not wildcards").not.toContainText(GAMMA)

  await page.goto(`/clients?q=${encodeURIComponent(`${runId} Beta, Ltd.`)}`)
  await expect(page.getByText("No clients match these filters.")).toBeVisible()
  await page.goto(`/clients?q=${encodeURIComponent(`${runId} Beta, Ltd.`)}&status=all`)
  await expect(page.getByTestId("client-list")).toContainText(BETA)
  await expect(page.getByTestId("client-list")).toContainText("Archived")

  await page.goto(`/clients?q=${encodeURIComponent(`${runId} Alpha*`)}`)
  await expect(page.getByText("No clients match these filters."), "* is literal too").toBeVisible()

  await page.goto(`/clients?q=${encodeURIComponent(runId)}&status=all&sort=name`)
  const names = await page.getByTestId("client-list").locator("div.flex-col > span.font-medium").allTextContents()
  expect(names).toEqual([ALPHA, BETA, GAMMA])
})

test("4. projects match the client's name, and filter by readiness", async () => {
  await page.goto(`/projects?q=${encodeURIComponent(`${runId} Alpha`)}`)
  await expect(page.getByTestId("project-list")).toContainText(PROJECT)
  await page.goto(`/projects?q=${encodeURIComponent(runId)}&readiness=APPROVED`)
  await expect(page.getByText("No projects match these filters.")).toBeVisible()
  await page.goto(`/projects?client=${clientIds[0]}`)
  await expect(page.getByTestId("project-list")).toContainText(PROJECT)
})

test("5. a lead is archived with a reason, read-only, filtered, then restored", async () => {
  await page.goto(`/leads/${leadIds[1]}`)
  const archive = page.getByTestId("lead-archive")
  await expect(archive.getByRole("button", { name: "Archive lead" }), "a reason is required").toBeDisabled()
  await archive.getByLabel("Reason").fill("Not a fit")
  await archive.getByRole("button", { name: "Archive lead" }).click()
  await expect(page.getByTestId("lead-archived")).toContainText("“Not a fit”")
  await expect(page.getByRole("button", { name: /Log follow-up/ })).toHaveCount(0)

  const { error: editError } = await seed.from("leads").update({ stage: "QUALIFIED" }).eq("id", leadIds[1])
  expect(editError?.message, "an archived lead can't be edited, even directly").toContain("archived and read-only")
  const { error: sneakError } = await seed.from("leads").update({ archived_at: null, archived_by: null, archive_reason: null }).eq("id", leadIds[1])
  expect(sneakError?.message, "nor un-archived without the control").toContain("Archive/Restore control")
  const { error: blankError } = await seed.rpc("set_lead_archived", { p_lead_id: leadIds[0], p_archived: true, p_reason: "  " })
  expect(blankError?.message).toContain("give a reason")

  await page.goto(`/leads?q=${encodeURIComponent(runId)}`)
  await expect(page.getByTestId("lead-list")).toContainText(LEAD_KEEP)
  await expect(page.getByTestId("lead-list")).not.toContainText(LEAD_ARCHIVE)
  await page.goto(`/leads?q=${encodeURIComponent(runId)}&status=archived`)
  await expect(page.getByTestId("lead-list")).toContainText(LEAD_ARCHIVE)
  await expect(page.getByTestId("lead-list")).not.toContainText(LEAD_KEEP)
  // Search by email.
  await page.goto(`/leads?q=${encodeURIComponent(`rahim-${runId}`)}`)
  await expect(page.getByTestId("result-count")).toHaveText("1 result")

  await page.goto(`/leads/${leadIds[1]}`)
  await page.getByTestId("lead-restore").getByLabel("Reason").fill("Came back")
  await page.getByTestId("lead-restore").getByRole("button", { name: "Restore lead" }).click()
  await expect(page.getByTestId("lead-archived")).toHaveCount(0)
  const { data: events } = await admin.from("lead_archive_events").select("event_type, reason, actor_id").eq("lead_id", leadIds[1]).order("seq")
  expect(events).toEqual([
    { event_type: "ARCHIVED", reason: "Not a fit", actor_id: owner!.userId },
    { event_type: "RESTORED", reason: "Came back", actor_id: owner!.userId },
  ])
})

test("6. files, financial records and reports filter", async () => {
  await page.goto(`/files?q=${encodeURIComponent(NOTE)}`)
  await expect(page.getByTestId("file-list")).toContainText(`https://example.com/${runId}/report`)
  await page.goto(`/files?q=${encodeURIComponent(NOTE)}&kind=file`)
  await expect(page.getByText("No evidence matches these filters.")).toBeVisible()

  await page.goto(`/projects/${projectId}/financials?value=PENDING`)
  await expect(page.getByTestId("result-count")).toHaveText("1 result")
  await page.goto(`/projects/${projectId}/financials?from=${thisMonth1}&to=${thisMonth1}&sort=amount_desc`)
  await expect(page.getByTestId("result-count"), "records overlapping the range, the straddling one included").toHaveText("4 results")

  await page.goto(`/reports?q=${encodeURIComponent(PROJECT)}`)
  await expect(page.getByTestId("report-list")).toContainText(PROJECT)
  await expect(page.getByTestId("report-list")).toContainText("no active share link")
  await expect(page.getByTestId("report-list").getByRole("link", { name: "Readiness" })).toBeVisible()
})

test("7. the dashboard compares periods truthfully for one project", async () => {
  await page.goto(`/dashboard?project=${projectId}&period=this_month`)
  await expect(page.getByTestId("dashboard-period")).toContainText(`${thisMonth1} to`)
  await expect(page.getByTestId("dashboard-period")).toContainText(PROJECT)

  const payment = page.getByTestId("money-CLIENT_PAYMENT_RECEIVED")
  await expect(payment).toContainText("BDT 5,000")
  await expect(payment).toContainText("1 pending excluded")
  await expect(payment).toContainText("BDT 4,000")
  await expect(payment).toContainText("+BDT 1,000 (+25.0%)")
  await expect(page.getByTestId("money-DIRECT_DELIVERY_COST")).toContainText("1 estimated")
  await expect(page.getByTestId("money-DIRECT_DELIVERY_COST")).toContainText("no records in the previous period")
  const spend = page.getByTestId("money-MARKETING_SPEND")
  await expect(spend, "the straddling record is in neither period").toContainText("No records in either period")

  const warnings = page.getByTestId("dashboard-warnings")
  await expect(warnings).toContainText("1 record(s) in this period and 1 in the previous one cover dates both inside and outside it")
  await expect(warnings).toContainText("1 pending or disputed record(s) are excluded")
  await expect(warnings).toContainText("1 record(s) in the totals are ESTIMATED")

  const profit = page.getByTestId("profit-row")
  await expect(profit).toHaveCount(1)
  await expect(profit).toContainText("BDT 3,800")
  await expect(profit).toContainText("INCOMPLETE")
  await expect(page.getByTestId("target-row")).toContainText("5 count / target 20 count (25%)")

  await page.goto(`/dashboard?project=${projectId}&period=custom&from=${thisMonth1}&to=${lastMonth1}`)
  await expect(warnings).toContainText("must start on or before its end date")

  await page.goto(`/dashboard?project=${projectId}&period=last_month`)
  await expect(page.getByTestId("money-CLIENT_PAYMENT_RECEIVED")).toContainText("BDT 4,000")
  await expect(page.getByTestId("money-CLIENT_PAYMENT_RECEIVED")).toContainText("no records in the previous period")
})

/** Opens the (collapsible) settings panel; it may already be open after a save. */
async function openCustomize(p: Page) {
  await p.getByTestId("customize-dashboard").evaluate((d) => ((d as HTMLDetailsElement).open = true))
}

test("8. dashboard cards can be hidden and shown; the warnings can't", async () => {
  await page.goto("/dashboard")
  await openCustomize(page)
  await page.getByLabel("Leads", { exact: true }).uncheck()
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByTestId("card-leads")).toHaveCount(0)
  await expect(page.getByTestId("dashboard-warnings")).toBeVisible()
  await openCustomize(page)
  await page.getByLabel("Leads", { exact: true }).check()
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByTestId("card-leads")).toBeVisible()
})

test("9. on a phone, search and filters work while edits stay disabled", async ({ browser }) => {
  const phone = await browser.newContext({ ...devices["Pixel 7"], storageState: await desktop.storageState() })
  const mobile = await phone.newPage()
  await mobile.goto("/clients")
  await expect(mobile.getByTestId("mobile-view-only")).toBeVisible()
  await mobile.getByLabel(/Name, legal name/).fill("50%_off")
  await mobile.getByRole("button", { name: "Apply" }).click()
  await expect(mobile.getByTestId("client-list")).toContainText(ALPHA)

  await mobile.goto(`/dashboard?project=${projectId}&period=this_month`)
  await expect(mobile.getByTestId("money-CLIENT_PAYMENT_RECEIVED")).toContainText("BDT 5,000")
  await expect(mobile.getByRole("button", { name: "Apply" })).toBeEnabled()
  await openCustomize(mobile)
  await expect(mobile.getByRole("button", { name: "Save" }), "saving settings is a write").toBeDisabled()

  await mobile.goto(`/leads/${leadIds[0]}`)
  await expect(mobile.getByTestId("lead-archive").getByLabel("Reason")).toBeDisabled()
  await phone.close()
})
