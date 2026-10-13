import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

import { devices, expect, request, test, type BrowserContext, type Page } from "@playwright/test"
import JSZip from "jszip"
import type { SupabaseClient } from "@supabase/supabase-js"

import { QUESTIONS } from "@/lib/questionnaire/v1"
import type { StructuredValue } from "@/lib/questionnaire/types"
import { validAnswer } from "./helpers/answers"
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
 * Application E2E for the Vera Wellness acceptance journey, driven through
 * the real app (production build) in a real browser: password + TOTP
 * enrollment, a fresh sign-in for approval, the real export generator and
 * ZIP download, and the public share page with its PIN Server Action and
 * cookie. Data that has no UI step in this journey (questionnaire answers,
 * financial records, targets, evidence) is seeded through the SAME RPCs the
 * app's server actions call, as the same QA user at aal2.
 *
 * "Vera Wellness" is a synthetic fixture name; never real client data.
 */

test.describe.configure({ mode: "serial" })

const runId = `e2e-${Date.now().toString(36)}`
const clientName = `${QA_CLIENT_PREFIX}${runId}`
const projectName = `Vera Wellness Launch ${runId}`
const approvalNote = `Vera Wellness QA ${runId} approval note`

// Canaries: must appear only where the rules allow.
const NORMAL_MARKER = `RG-NORMAL-${runId}`
const INTERNAL_CANARY = `RG-CANARY-INTERNAL-${runId}`
const SENSITIVE_CANARY = `RG-CANARY-SENSITIVE-${runId}`
const NOTE_CANARY = `RG-CANARY-NOTE-${runId}`

// Left unanswered by seeding and answered through the real questionnaire
// form in test 3. One of the 22 questions added from the draft; INTERNAL,
// so its answer must also stay out of the export.
const UI_ANSWERED_KEY = "E10.Q07"
const UI_ANSWER = `Book via email -- prepare from the enquiry -- quote within 24h, valid 14 days (${runId})`
// A structured question (dates + milestone rule), also answered in the UI.
const UI_STRUCTURED_KEY = "E13.Q04"
const REQUIRED_COUNT = 127
// Stored through the RPC with a value the save action would reject (not an
// option); readiness must flag it rather than trust the stored shape.
const MALFORMED_KEY = "E01.Q04"
const MALFORMED_VALUE = "Bankrupt"

// Distinctive amounts so a leak can't hide behind a common number.
const AMOUNTS = {
  CLIENT_PAYMENT_RECEIVED: 61111,
  CLIENT_OWN_REVENUE: 150777,
  MARKETING_SPEND: 15555,
  RESULTGRID_FEE: 40444,
  DIRECT_DELIVERY_COST: 5222,
  ALLOCATED_OPERATING_COST: 3333,
  OTHER_CAMPAIGN_COST: 2666,
} as const
const CLIENT_PROFIT = 150777 - 15555 - 40444 - 2666 // 92112
const RGD_PROFIT = 61111 - 5222 - 3333 // 52556

// A real 1x1 PNG, uploaded through the evidence form in test 2b.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
)
const EVIDENCE_FILE_NAME = `vera-gbp-screenshot-${runId}.png`

const EVIDENCE_URLS = [
  `https://example.com/${runId}/gbp-screenshot`,
  `https://example.com/${runId}/search-console-export`,
]

function pad(n: number) {
  return String(n).padStart(2, "0")
}
const now = new Date()
const thisMonthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
const thisMonthEnd = (() => {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})()
const novemberIsCurrentMonth = now.getFullYear() === 2026 && now.getMonth() === 10

/** A number, with or without thousands separators, not embedded in a longer token. */
function amountPattern(n: number): RegExp {
  const plain = String(n)
  const grouped = n.toLocaleString("en-US")
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\w.,])(?:${esc(plain)}|${esc(grouped)})(?![\\w])`)
}

let owner: QaOwner | null = null
let totpSecret = ""
let firstPasswordAuthAt = 0
let seedClient: SupabaseClient | null = null
let clientBusinessId = ""
let projectId = ""
let shareToken = ""
let evidenceFileId = ""
let sharePin = ""
const createdClientIds: string[] = []

let ownerFirst: BrowserContext // signed in once at the start; later used for the stale-reauth check
let ownerFresh: BrowserContext // signed in right before approving
let viewer: BrowserContext // anonymous client viewing the share link
let viewerPage: Page
const viewerBodies: { url: string; body: string }[] = []

/** The form's own error line (Next's route announcer also has role=alert). */
function formError(page: Page) {
  return page.locator("p[role=alert]")
}

async function signIn(page: Page, o: QaOwner) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(o.email)
  await page.getByLabel("Password").fill(o.password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

async function projectStatus() {
  const { data } = await admin.from("projects").select("readiness_status").eq("id", projectId).single()
  return data?.readiness_status
}

async function shareRow() {
  const { data } = await admin
    .from("client_share_links")
    .select("failed_pin_attempts, locked_until, session_nonce_hash, revoked_at")
    .eq("token", shareToken)
    .single()
  return data!
}

test.afterAll(async () => {
  for (const ctx of [ownerFirst, ownerFresh, viewer]) await ctx?.close().catch(() => {})
  const report = await cleanupQa(owner, createdClientIds)
  console.log("\nE2E cleanup report:", JSON.stringify(report, null, 2))
  if (report.authUser === "SOFT_DELETED") {
    console.log(`NOTE (reported separately, not a clean delete): QA auth user ${owner?.userId} ${report.authUserDetail}`)
  }
  expect(report.qaClientsRemaining, "this run's client_businesses left after purge").toBe(0)
  expect(report.qaProjectsRemaining, "this run's projects left after purge").toBe(0)
  expect(report.workspaceMembershipsRemaining, "QA workspace memberships left").toBe(0)
  expect(report.mfaFactorsRemaining, "QA MFA factors left").toBe(0)
  expect(report.authUser, report.authUserDetail).not.toBe("NOT_DELETED")
})

test("1. owner signs in with password and completes mandatory TOTP enrollment", async ({ browser }) => {
  owner = await createQaOwner(runId)
  ownerFirst = await browser.newContext()
  const page = await ownerFirst.newPage()

  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)

  firstPasswordAuthAt = Date.now()
  await signIn(page, owner)
  await expect(page).toHaveURL(/\/setup\/totp$/)

  // No way around enrollment: any app route bounces back here.
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/setup\/totp$/)

  const secretEl = page.locator("p.font-mono")
  await expect(secretEl).toBeVisible()
  totpSecret = (await secretEl.textContent())!.trim()
  expect(totpSecret).toMatch(/^[A-Z2-7]+=*$/)

  await page.getByLabel("Authenticator code").fill("000000")
  await page.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(formError(page)).toHaveText("Incorrect or expired code. Try again.")

  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Confirm and continue" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  const cookies = await ownerFirst.cookies()
  for (const name of ["rg_session_started_at", "rg_last_activity_at", "rg_device_id"]) {
    const c = cookies.find((x) => x.name === name)
    expect(c, `${name} cookie`).toBeTruthy()
    expect(c!.httpOnly, `${name} httpOnly`).toBe(true)
    expect(c!.secure, `${name} secure (production build)`).toBe(true)
    expect(c!.sameSite, `${name} sameSite`).toBe("Lax")
  }
})

test("2. seed Vera Wellness data through the app's RPCs as the same user", async () => {
  seedClient = await signInAtAal2(owner!, totpSecret)
  const { data: ws } = await admin.from("workspaces").select("id").limit(1).single()

  const { data: cb, error: cbError } = await seedClient
    .from("client_businesses")
    .insert({ workspace_id: ws!.id, display_name: clientName, record_type: "EXTERNAL_CLIENT", country: "Bangladesh", timezone: "Asia/Dhaka" })
    .select("id")
    .single()
  expect(cbError).toBeNull()
  clientBusinessId = cb!.id
  createdClientIds.push(clientBusinessId)

  const { data: project, error: projectError } = await seedClient
    .from("projects")
    .insert({
      workspace_id: ws!.id,
      client_business_id: clientBusinessId,
      project_name: projectName,
      project_type: "FULL_DIGITAL_MARKETING",
      lifecycle_status: "ACTIVE",
      default_currency: "BDT",
      timezone: "Asia/Dhaka",
    })
    .select("id")
    .single()
  expect(projectError).toBeNull()
  projectId = project!.id

  let normalMarked = false
  let internalMarked = false
  let sensitiveMarked = false
  expect(QUESTIONS).toHaveLength(130)
  expect(QUESTIONS.filter((q) => q.required)).toHaveLength(REQUIRED_COUNT)
  for (const q of QUESTIONS) {
    if (q.key === UI_ANSWERED_KEY || q.key === UI_STRUCTURED_KEY) continue
    let value: string | StructuredValue
    const freeText = q.type === "SHORT_TEXT" || q.type === "LONG_TEXT"
    if (q.key === MALFORMED_KEY) value = MALFORMED_VALUE
    else if (!freeText) value = validAnswer(q, "")
    else if (q.sensitivity === "NORMAL" && !normalMarked) {
      value = NORMAL_MARKER
      normalMarked = true
    } else if (q.sensitivity === "INTERNAL" && !internalMarked) {
      value = INTERNAL_CANARY
      internalMarked = true
    } else if (q.sensitivity === "SENSITIVE" && !sensitiveMarked) {
      value = SENSITIVE_CANARY
      sensitiveMarked = true
    } else value = validAnswer(q, `Vera Wellness QA answer (${q.key})`)

    const { error } = await seedClient.rpc("upsert_project_answer", {
      p_project_id: projectId,
      p_question_key: q.key,
      p_questionnaire_version: 1,
      p_status: "ANSWERED",
      p_value: value,
      p_next_readiness_status: "READY_FOR_REVIEW",
    })
    expect(error, `answer ${q.key}`).toBeNull()
  }
  expect(normalMarked && internalMarked && sensitiveMarked).toBe(true)

  for (const url of EVIDENCE_URLS) {
    const { error } = await seedClient.rpc("add_evidence_item", {
      p_project_id: projectId,
      p_category: "evidence",
      p_external_url: url,
      p_verification_status: "OWNER_REPORTED",
    })
    expect(error).toBeNull()
  }

  for (const [recordType, amount] of Object.entries(AMOUNTS)) {
    const attributed = recordType === "CLIENT_OWN_REVENUE"
    const { error } = await seedClient.rpc("add_financial_record", {
      p_project_id: projectId,
      p_record_type: recordType,
      p_amount: amount,
      p_value_status: "CONFIRMED",
      p_period_start: "2026-11-01",
      p_period_end: "2026-11-30",
      p_evidence_status: attributed ? "VERIFIED" : "OWNER_REPORTED",
      p_evidence_url: attributed ? `https://example.com/${runId}/booking-report` : undefined,
      p_notes: recordType === "RESULTGRID_FEE" ? NOTE_CANARY : undefined,
      p_attributed_to_marketing: attributed,
    })
    expect(error, recordType).toBeNull()
  }

  const targets = [
    { metric: "PAYING_CLIENTS", unit: "count", target: 3, actual: 1, start: "2026-11-01", end: "2026-11-30" },
    { metric: "LEADS", unit: "count", target: 30, actual: 12, start: "2026-11-01", end: "2026-11-30" },
    { metric: "MEETINGS", unit: "count", target: 5, actual: 2, start: thisMonthStart, end: thisMonthEnd },
  ]
  for (const t of targets) {
    const { data, error } = await seedClient.rpc("add_project_target", {
      p_project_id: projectId,
      p_metric: t.metric,
      p_unit: t.unit,
      p_target: t.target,
      p_period_start: t.start,
      p_period_end: t.end,
    })
    expect(error).toBeNull()
    const targetId = (Array.isArray(data) ? data[0] : data)?.id
    const { error: actualError } = await seedClient.rpc("update_project_target_actual", {
      p_target_id: targetId,
      p_project_id: projectId,
      p_actual: t.actual,
    })
    expect(actualError).toBeNull()
  }

  expect(await projectStatus()).toBe("INCOMPLETE")
})

test("2b. an evidence file is uploaded through the real form, checked, and downloadable", async () => {
  const page = await ownerFirst.newPage()
  await page.goto(`/projects/${projectId}/evidence`)
  await page.getByRole("radio", { name: "File" }).click()

  // A PNG renamed to .pdf: the bytes are checked, not just the name.
  await page.locator("#file").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: PNG_BYTES })
  await page.getByRole("button", { name: "Upload file" }).click()
  await expect(formError(page)).toContainText("aren't a PDF file (they look like PNG)")
  const { count: afterRefusal } = await admin
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .not("storage_path", "is", null)
  expect(afterRefusal, "nothing recorded for the refused file").toBe(0)
  const { data: ws } = await admin.from("workspaces").select("id").limit(1).single()
  const { data: strays } = await admin.storage.from("evidence").list(`${ws!.id}/${projectId}`)
  expect(strays ?? [], "the refused upload was deleted from Storage").toHaveLength(0)
  const { data: refusedUpload } = await admin
    .from("evidence_uploads")
    .select("id, status, storage_path")
    .eq("project_id", projectId)
    .single()
  expect(refusedUpload!.status, "the refused upload is discarded").toBe("DISCARDED")
  const { data: refusedCleanup } = await admin
    .from("storage_cleanup_queue")
    .select("outcome")
    .eq("storage_path", refusedUpload!.storage_path)
    .single()
  expect(refusedCleanup!.outcome, "its file deletion went through the queue").toBe("DELETED")

  // An unlisted type is refused before any upload.
  await page.locator("#file").setInputFiles({ name: "notes.html", mimeType: "text/html", buffer: Buffer.from("<p>x</p>") })
  await page.getByRole("button", { name: "Upload file" }).click()
  await expect(formError(page)).toContainText("This file type isn't allowed")

  await page.locator("#file").setInputFiles({ name: EVIDENCE_FILE_NAME, mimeType: "image/png", buffer: PNG_BYTES })
  const finalizeRequest = page.waitForRequest(
    (r) => r.method() === "POST" && !!r.headers()["next-action"] && (r.postData() ?? "").includes("verificationStatus")
  )
  await page.getByRole("button", { name: "Upload file" }).click()
  const finalize = await finalizeRequest
  const fileLink = page.getByTestId("evidence-file-link").filter({ hasText: EVIDENCE_FILE_NAME })
  await expect(fileLink).toBeVisible()

  const { data: stored } = await admin
    .from("evidence_items")
    .select("id, storage_path, content_type, size_bytes, sha256, original_filename")
    .eq("project_id", projectId)
    .not("storage_path", "is", null)
    .single()
  evidenceFileId = stored!.id
  expect(stored).toMatchObject({
    content_type: "image/png",
    size_bytes: PNG_BYTES.length,
    sha256: createHash("sha256").update(PNG_BYTES).digest("hex"),
    original_filename: EVIDENCE_FILE_NAME,
  })
  expect(stored!.storage_path).toMatch(new RegExp(`^${ws!.id}/${projectId}/[0-9a-f-]{36}\.png$`))

  const { data: recordedUpload } = await admin
    .from("evidence_uploads")
    .select("id, status, evidence_item_id, verified_sha256")
    .eq("storage_path", stored!.storage_path!)
    .single()
  expect(recordedUpload).toMatchObject({ status: "RECORDED", evidence_item_id: stored!.id, verified_sha256: stored!.sha256 })

  // Replaying the real finalize request -- as is, with invalid fields, with
  // an unknown upload, or with the discarded upload -- never deletes or
  // duplicates the recorded file.
  const [argProject, argUpload, argFields] = JSON.parse(finalize.postData()!) as [string, string, Record<string, string>]
  expect([argProject, argUpload]).toEqual([projectId, recordedUpload!.id])
  const replay = (args: unknown[]) =>
    page.request.post(finalize.url(), {
      headers: {
        "next-action": finalize.headers()["next-action"],
        "content-type": finalize.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
      },
      data: JSON.stringify(args),
    })
  for (const [label, args] of [
    ["the same request again", [projectId, argUpload, argFields]],
    ["invalid fields", [projectId, argUpload, { ...argFields, category: "not-a-category" }]],
    ["an unknown upload id", [projectId, crypto.randomUUID(), argFields]],
    ["the discarded upload", [projectId, refusedUpload!.id, argFields]],
  ] as const) {
    const replayed = await replay([...args])
    expect(replayed.status(), label).toBe(200)
  }
  const { count: attachmentsAfterReplay } = await admin
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .not("storage_path", "is", null)
  expect(attachmentsAfterReplay, "replays record nothing new").toBe(1)
  const { data: replayedUploads } = await admin.from("evidence_uploads").select("id, status").eq("project_id", projectId).order("created_at")
  expect(replayedUploads!.map((u) => u.status)).toEqual(["DISCARDED", "RECORDED"])
  const { count: queuedForStoredFile } = await admin
    .from("storage_cleanup_queue")
    .select("id", { count: "exact", head: true })
    .eq("storage_path", stored!.storage_path!)
  expect(queuedForStoredFile, "the recorded file was never queued for deletion").toBe(0)

  // The download link hands out the same bytes, as a download.
  const response = await page.request.get(`/projects/${projectId}/evidence/${stored!.id}/file`)
  expect(response.status()).toBe(200)
  expect(Buffer.from(await response.body()).equals(PNG_BYTES)).toBe(true)
  expect(response.headers()["content-disposition"]).toContain(EVIDENCE_FILE_NAME)
  // Without a session there is nothing to download.
  const anonymous = await request.newContext({ baseURL: test.info().project.use.baseURL })
  const anonResponse = await anonymous.get(`/projects/${projectId}/evidence/${stored!.id}/file`, { maxRedirects: 0 })
  expect(anonResponse.status(), "anonymous request is sent to login, not to the file").toBe(307)
  expect(anonResponse.headers()["location"]).toContain("/login")
  await anonymous.dispose()
})

test("3. fresh password + TOTP sign-in, mark ready, approve with a note", async ({ browser }) => {
  ownerFresh = await browser.newContext()
  const page = await ownerFresh.newPage()
  await signIn(page, owner!)
  await expect(page).toHaveURL(/\/login\/verify$/)
  await page.getByLabel("Authenticator code").fill(await freshTotp(totpSecret))
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  const problemLink = (key: string) =>
    page.getByRole("link", { name: new RegExp(`^\\[${key.replace(".", "\\.")}\\]`) })

  await page.goto(`/projects/${projectId}/readiness`)
  // The questions left for the UI are reported missing, and block review.
  await expect(problemLink(UI_ANSWERED_KEY)).toBeVisible()
  await expect(problemLink(UI_STRUCTURED_KEY)).toBeVisible()
  await expect(problemLink(MALFORMED_KEY)).toBeVisible()
  await expect(page.getByText(`Stored answer is not valid for this question: "${MALFORMED_VALUE}" is not an option.`)).toBeVisible()
  await expect(page.getByRole("button", { name: "Mark ready for review" })).toBeDisabled()

  // Answer the text question through the real questionnaire form (autosaves on blur).
  await page.goto(`/projects/${projectId}/questionnaire`)
  const uiQuestion = QUESTIONS.find((q) => q.key === UI_ANSWERED_KEY)!
  const field = page.locator(`[id="q-${UI_ANSWERED_KEY}"]`)
  const fieldBlock = page.locator("div.border-b", { has: field })
  await expect(fieldBlock.getByText(uiQuestion.question)).toBeVisible()
  await expect(fieldBlock.getByText(uiQuestion.purpose)).toBeVisible()
  await expect(fieldBlock.getByRole("button", { name: "Not applicable" }), "required questions offer no N/A shortcut").toHaveCount(0)
  await field.fill("Draft")
  await field.blur()
  await expect(fieldBlock.getByText("Saved", { exact: true })).toBeVisible()

  // A failed save is reported, and the earlier "Saved" does not linger.
  const abortActions = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.continue()
  await page.route("**/questionnaire", abortActions)
  await field.fill(UI_ANSWER)
  await field.blur()
  await expect(fieldBlock.getByRole("alert")).toContainText("Not saved: Could not reach the server.")
  await expect(fieldBlock.getByText("Saved", { exact: true })).toHaveCount(0)
  await page.unroute("**/questionnaire", abortActions)
  await field.focus()
  await field.blur()
  await expect(fieldBlock.getByText("Saved", { exact: true })).toBeVisible()
  await expect(fieldBlock.getByRole("alert")).toHaveCount(0)
  await expect(fieldBlock.getByText("ANSWERED", { exact: true })).toBeVisible()
  const { data: stored } = await admin
    .from("project_answers")
    .select("status, value")
    .eq("project_id", projectId)
    .eq("question_key", UI_ANSWERED_KEY)
    .single()
  expect(stored).toEqual({ status: "ANSWERED", value: UI_ANSWER })

  // A structured question: an invalid draft saves, shows its issue, and blocks readiness.
  const schedule = page.locator(`div[id="q-${UI_STRUCTURED_KEY}"]`)
  const scheduleField = (id: string) => page.locator(`[id="q-${UI_STRUCTURED_KEY}-${id}"]`)
  await scheduleField("startDate").fill("2026-11-01")
  await scheduleField("startDate").blur()
  await scheduleField("finalDate").fill("2026-10-01")
  await scheduleField("finalDate").blur()
  await scheduleField("milestones").fill("No interim milestones")
  await scheduleField("milestones").blur()
  await expect(schedule.getByTestId("answer-issues")).toHaveText("The final target date cannot be before the start date.")
  await page.goto(`/projects/${projectId}/readiness`)
  await expect(problemLink(UI_STRUCTURED_KEY)).toBeVisible()
  await expect(page.getByText("The final target date cannot be before the start date.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Mark ready for review" })).toBeDisabled()
  await page.goto(`/projects/${projectId}/questionnaire`)
  await scheduleField("finalDate").fill("2027-04-30")
  await scheduleField("finalDate").blur()
  await expect(schedule.getByText("Saved", { exact: true })).toBeVisible()
  await expect(schedule.getByTestId("answer-issues")).toHaveCount(0)
  const { data: storedSchedule } = await admin
    .from("project_answers")
    .select("value")
    .eq("project_id", projectId)
    .eq("question_key", UI_STRUCTURED_KEY)
    .single()
  expect(storedSchedule!.value).toEqual({ startDate: "2026-11-01", finalDate: "2027-04-30", milestones: "No interim milestones" })

  // The malformed stored value is replaced through the form.
  await page.locator(`[id="q-${MALFORMED_KEY}"]`).click()
  await page.getByRole("option", { name: "Operating", exact: true }).click()
  await expect(page.locator("div.border-b", { has: page.locator(`[id="q-${MALFORMED_KEY}"]`) }).getByText("Saved", { exact: true })).toBeVisible()

  // A condition: taking ads out of scope removes the ad questions; putting
  // them back restores them with their stored answers.
  const adsStatus = page.locator('[id="q-E09.Q01-status"]')
  const notApplicableRow = (key: string) => page.locator(`[data-testid="not-applicable-question"][id="q-${key}"]`)
  await adsStatus.click()
  await page.getByRole("option", { name: "Out of scope" }).click()
  await expect(notApplicableRow("E09.Q05")).toContainText("doesn't apply, based on E09.Q01")
  await expect(page.locator('[id="q-E09.Q05-amount"]')).toHaveCount(0)
  await adsStatus.click()
  await page.getByRole("option", { name: "Running", exact: true }).click()
  await expect(page.locator('[id="q-E09.Q05-amount"]')).toHaveValue("30000")
  await expect(notApplicableRow("E09.Q05")).toHaveCount(0)

  await page.goto(`/projects/${projectId}/readiness`)
  await expect(page.getByText(`${REQUIRED_COUNT} / ${REQUIRED_COUNT} required questions complete`)).toBeVisible()
  await expect(page.getByText("All required questions are answered and valid.")).toBeVisible()
  await page.getByRole("button", { name: "Mark ready for review" }).click()
  await expect(page.getByText("READY_FOR_REVIEW", { exact: true })).toBeVisible()

  await page.getByLabel("Approval note (optional)").fill(approvalNote)
  await page.getByRole("button", { name: "Approve & generate export" }).click()
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible()
  await expect(page.getByText(`“${approvalNote}”`)).toBeVisible()

  expect(await projectStatus()).toBe("APPROVED")
  const { data: approved } = await admin
    .from("project_approval_events")
    .select("export_version, reason, actor_id")
    .eq("project_id", projectId)
    .eq("event_type", "APPROVED")
    .single()
  expect(approved).toEqual({ export_version: 1, reason: approvalNote, actor_id: owner!.userId })
})

test("4. export ZIP: download serves the approved snapshot, generated from real data", async () => {
  const page = await ownerFresh.newPage()
  await page.goto(`/projects/${projectId}/readiness`)
  await page.getByRole("link", { name: "View / download" }).click()
  await expect(page.getByRole("heading", { name: /Export package/ })).toContainText("v01")

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-zip").click(),
  ])
  // H01/H08: ResultGrid-Digital_{client}_{project}_{YYYY-MM-DD}_vNN, dated in Asia/Dhaka.
  const exportDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date())
  const expectedPackage = `ResultGrid-Digital_Vera-Wellness-QA-${runId}_Vera-Wellness-Launch-${runId}_${exportDay}_v01`
  expect(download.suggestedFilename()).toBe(`${expectedPackage}.zip`)
  await expect(page.getByTestId("package-name")).toHaveText(expectedPackage)
  const zip = await JSZip.loadAsync(readFileSync(await download.path()))
  expect(Object.keys(zip.files).sort()).toEqual(["EVIDENCE_INDEX.md", "EXPORT_MANIFEST.md", "PROJECT_CONTEXT.md"])

  const context = await zip.file("PROJECT_CONTEXT.md")!.async("string")
  const evidenceIndex = await zip.file("EVIDENCE_INDEX.md")!.async("string")
  const manifest = await zip.file("EXPORT_MANIFEST.md")!.async("string")

  // Byte-identical to the immutable DB snapshot the approval bound to.
  const { data: snapshot } = await admin
    .from("project_exports")
    .select("content, evidence_index_content, export_manifest_content")
    .eq("project_id", projectId)
    .eq("version", 1)
    .single()
  expect(context).toBe(snapshot!.content)
  expect(evidenceIndex).toBe(snapshot!.evidence_index_content)
  expect(manifest).toBe(snapshot!.export_manifest_content)

  // Generated from the real project data, not placeholders.
  expect(context).toContain(`- Client/Business: ${clientName} (EXTERNAL_CLIENT, Bangladesh)`)
  expect(context).toContain(`- Project: ${projectName}`)
  expect(context).toContain("- Currency: BDT")
  expect(context).toContain("- Export version: v01")
  expect(context).toContain(NORMAL_MARKER)
  expect(context, "INTERNAL answers are excluded from the export").not.toContain(INTERNAL_CANARY)
  expect(context, "SENSITIVE answers are excluded from the export").not.toContain(SENSITIVE_CANARY)
  expect(context, "the INTERNAL answer given through the UI is excluded from the export").not.toContain(UI_ANSWER)
  expect(context, "a new NORMAL question is exported").toContain("**What is the current readiness of each product or service?**")
  expect(context, "structured NORMAL answers render as labelled fields").toContain(
    "- Website status: Live\n- URL or domain: https://example.com/vera\n- Ownership: Owned by the business"
  )
  expect(context).toContain("- Primary country: Bangladesh (BD)")
  expect(context, "INTERNAL structured answers stay excluded").not.toContain("Work may start")
  expect(context).toMatch(/# Open Optional Items\n\nNone\./)

  for (const url of EVIDENCE_URLS) expect(evidenceIndex).toContain(`- Reference: ${url}`)
  expect(evidenceIndex.match(/- Verification: OWNER_REPORTED/g)).toHaveLength(3)
  // The uploaded file is referenced (name, type, size, hash), never copied in.
  expect(evidenceIndex).toContain(`## ${EVIDENCE_FILE_NAME}`)
  expect(evidenceIndex).toContain(
    `- Reference: File attached in ResultGrid Digital (image/png, 1 KB, SHA-256 ${createHash("sha256").update(PNG_BYTES).digest("hex")}); not included in this package`
  )

  expect(manifest).toContain("- Files: PROJECT_CONTEXT.md, EVIDENCE_INDEX.md, EXPORT_MANIFEST.md")
  expect(manifest).toContain("- Export version: v01")
  expect(manifest).toContain(`- Questionnaire answers recorded: ${QUESTIONS.length} of ${QUESTIONS.length} applicable questions`)
  expect(manifest).toContain("- Questions not applicable to this project (by earlier answers or project type): 0")
  expect(manifest).toContain("- Evidence items indexed: 3")
  expect(manifest).toContain(`- Package: ${expectedPackage}`)

  // H07: PROJECT_CONTEXT.md on its own, byte-identical to the stored file.
  const [contextDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-context").click()])
  expect(contextDownload.suggestedFilename()).toBe("PROJECT_CONTEXT.md")
  expect(readFileSync(await contextDownload.path(), "utf8")).toBe(snapshot!.content)

  // The stored snapshot is the approved one, so it must say so.
  expect(context).toContain("- Approval status at export time: APPROVED")
  expect(manifest).toContain("- Project approval status at export time: APPROVED")
})

test("5. share link: PIN, lockout, cookie, rendered report, periods, no internal data", async ({ browser }) => {
  const ownerPage = await ownerFresh.newPage()
  await ownerPage.goto(`/projects/${projectId}/reports`)
  await expect(ownerPage.getByText(amountPattern(CLIENT_PROFIT))).toBeVisible()

  await ownerPage.goto(`/projects/${projectId}/share-links`)
  await ownerPage.getByRole("button", { name: "Create new share link" }).click()
  const linkText = (await ownerPage.getByText(/^Link:/).locator("span.font-mono").textContent())!.trim()
  await expect(ownerPage.getByText("Rules v2").first(), "a new link uses the current report rules").toBeVisible()
  sharePin = (await ownerPage.locator("span.font-mono.text-base").textContent())!.trim()
  expect(sharePin).toMatch(/^\d{6}$/)
  shareToken = new URL(linkText).pathname.split("/").pop()!
  const sharePath = `/share/${shareToken}`

  // The client opens the link on a phone (spec I08: report links are
  // responsive, and the PIN form is one of the few writes a phone may make).
  viewer = await browser.newContext({ ...devices["Pixel 7"] })
  viewerPage = await viewer.newPage()
  // Route interception buffers every body, including ones a later
  // navigation would discard before response.text() could read them.
  await viewer.route("**/*", async (route) => {
    const response = await route.fetch()
    const type = response.headers()["content-type"] ?? ""
    if (/text\/|json|x-component/.test(type)) {
      viewerBodies.push({ url: route.request().url(), body: (await response.body()).toString("utf8") })
    }
    await route.fulfill({ response })
  })

  const submitPin = async (pin: string) => {
    await viewerPage.getByLabel("PIN").fill(pin)
    await Promise.all([
      viewerPage.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(sharePath)),
      viewerPage.getByRole("button", { name: "View report" }).click(),
    ])
  }

  await viewerPage.goto(sharePath)
  await expect(viewerPage.getByText("Enter PIN")).toBeVisible()

  const wrongPin = sharePin === "000000" ? "111111" : "000000"
  for (let attempt = 1; attempt <= 4; attempt++) {
    await submitPin(wrongPin)
    await expect(formError(viewerPage)).toHaveText("Incorrect PIN.")
    expect((await shareRow()).failed_pin_attempts).toBe(attempt)
  }
  await submitPin(wrongPin)
  await expect(formError(viewerPage)).toHaveText("Too many incorrect attempts. Try again in a few minutes.")
  const locked = await shareRow()
  expect(locked.failed_pin_attempts).toBe(0)
  expect(new Date(locked.locked_until!).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)

  // The CORRECT PIN, submitted through the real form while locked out.
  await submitPin(sharePin)
  await expect(formError(viewerPage)).toHaveText("Too many incorrect attempts. Try again in a few minutes.")
  await expect(viewerPage.getByText("Enter PIN")).toBeVisible()
  expect((await viewer.cookies()).some((c) => c.name === `rg_share_${shareToken}`)).toBe(false)
  expect((await shareRow()).session_nonce_hash).toBeNull()

  // Test control: end the 15-minute lockout instead of waiting it out.
  await admin
    .from("client_share_links")
    .update({ locked_until: new Date(Date.now() - 1_000).toISOString() })
    .eq("token", shareToken)

  await submitPin(sharePin)
  await expect(viewerPage.getByRole("heading", { name: projectName })).toBeVisible()
  await expect(viewerPage.getByText(`BDT ${CLIENT_PROFIT.toLocaleString("en-US")}`)).toBeVisible()

  const shareCookie = (await viewer.cookies()).find((c) => c.name === `rg_share_${shareToken}`)
  expect(shareCookie, "share session cookie").toBeTruthy()
  expect(shareCookie!.httpOnly).toBe(true)
  expect(shareCookie!.secure).toBe(true)
  expect(shareCookie!.sameSite).toBe("Lax")
  expect(shareCookie!.path).toBe(sharePath)
  const cookieLifetime = shareCookie!.expires * 1000 - Date.now()
  expect(cookieLifetime).toBeGreaterThan(115 * 60_000)
  expect(cookieLifetime).toBeLessThan(121 * 60_000)
  const storedHash = (await shareRow()).session_nonce_hash
  expect(storedHash, "DB stores only the hash of the cookie's nonce").toBe(
    createHash("sha256").update(shareCookie!.value).digest("hex")
  )
  expect(storedHash).not.toBe(shareCookie!.value)

  // All-time view: all three targets with their actuals.
  const allTimeText = await viewerPage.locator("body").innerText()
  expect(allTimeText).toMatch(/Paying clients \(2026-11-01 to 2026-11-30\)\s*Target 3 count · Actual 1 count/)
  expect(allTimeText).toMatch(/Leads \(2026-11-01 to 2026-11-30\)\s*Target 30 count · Actual 12 count/)
  expect(allTimeText).toMatch(/Meetings \([\d-]+ to [\d-]+\)\s*Target 5 count · Actual 2 count/)

  const renderedTexts = [allTimeText]
  // A new link uses report rules v2: stated on the report, with weekly periods.
  await expect(viewerPage.getByTestId("report-rules")).toContainText("Calculation rules v2")
  for (const label of ["This week", "Last week", "Last quarter"]) {
    await expect(viewerPage.getByText(label, { exact: true }), label).toBeVisible()
  }
  await viewerPage.getByText("This week", { exact: true }).click()
  await expect(viewerPage).toHaveURL(/period=this_week/)
  await expect(viewerPage.getByText(/Period: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible()
  await viewerPage.goto(sharePath)
  if (!novemberIsCurrentMonth) {
    await viewerPage.getByText("This month", { exact: true }).click()
    await expect(viewerPage).toHaveURL(/period=this_month/)
    await expect(viewerPage.getByText(/Not enough recorded, evidenced, marketing-attributed data/)).toBeVisible()
    const monthText = await viewerPage.locator("body").innerText()
    expect(monthText).toContain("Meetings (")
    expect(monthText, "November targets are outside this month").not.toContain("Leads (")
    expect(monthText).not.toMatch(amountPattern(CLIENT_PROFIT))
    renderedTexts.push(monthText)
  }
  if (now.getFullYear() === 2026) {
    await viewerPage.getByText("This year", { exact: true }).click()
    await expect(viewerPage).toHaveURL(/period=this_year/)
    await expect(viewerPage.getByText(`BDT ${CLIENT_PROFIT.toLocaleString("en-US")}`)).toBeVisible()
    renderedTexts.push(await viewerPage.locator("body").innerText())
  }

  // Forged cookies in a separate browser never unlock the report.
  const forger = await browser.newContext()
  const cookieDomain = new URL(test.info().project.use.baseURL!).hostname
  for (const value of ["1", createHash("sha256").update(runId).digest("base64url")]) {
    await forger.addCookies([{ name: `rg_share_${shareToken}`, value, domain: cookieDomain, path: sharePath }])
    const p = await forger.newPage()
    await p.goto(sharePath)
    await expect(p.getByText("Enter PIN")).toBeVisible()
    await expect(p.getByText(amountPattern(CLIENT_PROFIT))).toHaveCount(0)
    await p.close()
  }
  await forger.close()

  // A link created before the rules changed keeps its rules (test control:
  // the migration set existing links to v1; this one is set the same way).
  const { error: legacyError } = await admin.from("client_share_links").update({ report_rules_version: 1 }).eq("token", shareToken)
  expect(legacyError).toBeNull()
  await viewerPage.goto(sharePath)
  await expect(viewerPage.getByTestId("report-rules")).toContainText("Calculation rules v1")
  await expect(viewerPage.getByText("This week", { exact: true }), "v1 links don't gain new periods").toHaveCount(0)
  await expect(viewerPage.getByText(amountPattern(CLIENT_PROFIT))).toBeVisible()
  renderedTexts.push(await viewerPage.locator("body").innerText())
  await ownerPage.goto(`/projects/${projectId}/reports`)
  await expect(ownerPage.getByTestId("preview-rules")).toContainText("1 active share link uses v1")

  // No internal data in what the client's browser rendered OR received.
  const bodies = viewerBodies
  expect(
    bodies.some((b) => amountPattern(CLIENT_PROFIT).test(b.body)),
    `positive control: captured responses include the report. Captured: ${bodies.map((b) => `${b.url} (${b.body.length}b)`).join(", ")}`
  ).toBe(true)
  const forbidden: [string, RegExp][] = [
    ["ResultGrid fee", amountPattern(AMOUNTS.RESULTGRID_FEE)],
    ["client payment received", amountPattern(AMOUNTS.CLIENT_PAYMENT_RECEIVED)],
    ["direct delivery cost", amountPattern(AMOUNTS.DIRECT_DELIVERY_COST)],
    ["allocated operating cost", amountPattern(AMOUNTS.ALLOCATED_OPERATING_COST)],
    ["ResultGrid internal profit", amountPattern(RGD_PROFIT)],
    ["financial note", new RegExp(NOTE_CANARY)],
    ["INTERNAL answer", new RegExp(INTERNAL_CANARY)],
    ["SENSITIVE answer", new RegExp(SENSITIVE_CANARY)],
    ["owner email", new RegExp(owner!.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))],
    ["internal record type names", /CLIENT_PAYMENT_RECEIVED|DIRECT_DELIVERY_COST|ALLOCATED_OPERATING_COST|RESULTGRID_FEE/],
  ]
  for (const [label, pattern] of forbidden) {
    for (const text of renderedTexts) expect(text, `rendered report leaks ${label}`).not.toMatch(pattern)
    const leak = bodies.find((b) => pattern.test(b.body))
    expect(leak?.url, `a response leaks ${label}`).toBeUndefined()
  }
})

test("6. revoking the link ends an already-open client session", async () => {
  await viewerPage.goto(`/share/${shareToken}`)
  await expect(viewerPage.getByRole("heading", { name: projectName })).toBeVisible()

  const ownerPage = await ownerFresh.newPage()
  await ownerPage.goto(`/projects/${projectId}/share-links`)
  await ownerPage.getByRole("button", { name: "Revoke" }).click()
  await expect(ownerPage.getByText("Revoked", { exact: true })).toBeVisible()

  const row = await shareRow()
  expect(row.revoked_at).not.toBeNull()
  expect(row.session_nonce_hash).toBeNull()

  // Same browser, same cookie still present -- access is gone.
  expect((await viewer.cookies()).some((c) => c.name === `rg_share_${shareToken}`)).toBe(true)
  await viewerPage.reload()
  await expect(viewerPage.getByText("Link not available")).toBeVisible()
  await expect(viewerPage.getByText(amountPattern(CLIENT_PROFIT))).toHaveCount(0)
})

test("6b. archive makes the project read-only; restore brings it back; the client is fixed", async () => {
  const page = await ownerFresh.newPage()
  await page.goto(`/projects/${projectId}`)
  await expect(page.getByTestId("locked-client")).toHaveText(clientName)
  await expect(page.locator("#clientBusinessId"), "no client picker on an existing project").toHaveCount(0)
  await expect(page.locator("#lifecycleStatus"), "lifecycle is not a form field").toHaveCount(0)
  await expect(page.getByTestId("lifecycle-status")).toHaveText("ACTIVE")

  await page.getByLabel("Reason (optional)").fill(`QA archive check ${runId}`)
  await page.getByRole("button", { name: "Archive", exact: true }).click()
  await expect(page.getByTestId("lifecycle-status")).toHaveText("ARCHIVED")
  await expect(page.getByText("Read-only while the project is archived.")).toBeVisible()
  await expect(page.getByText(`“QA archive check ${runId}”`)).toBeVisible()
  // It has exports, approvals and money records, so it can never be hard-deleted.
  await expect(page.getByTestId("retained-history")).toContainText(
    "it has approved exports, approval history, financial records, which are kept as history"
  )
  await expect(page.getByRole("button", { name: "Delete permanently" })).toHaveCount(0)

  // The questionnaire refuses edits and says why.
  await page.goto(`/projects/${projectId}/questionnaire`)
  const field = page.locator('[id="q-E01.Q01"]')
  const block = page.locator("div.border-b", { has: field })
  await field.fill(`${NORMAL_MARKER} edited while archived`)
  await field.blur()
  await expect(block.getByRole("alert")).toHaveText("Not saved: This project is archived and read-only: restore it first.")
  const { data: unchanged } = await admin
    .from("project_answers")
    .select("value")
    .eq("project_id", projectId)
    .eq("question_key", "E01.Q01")
    .single()
  expect(unchanged!.value).toBe(NORMAL_MARKER)

  await page.goto(`/projects/${projectId}`)
  await page.getByRole("button", { name: "Restore", exact: true }).click()
  await expect(page.getByTestId("lifecycle-status")).toHaveText("ACTIVE")
  const { data: history } = await admin
    .from("lifecycle_events")
    .select("event_type, from_status, to_status, actor_id")
    .eq("entity_id", projectId)
    .order("created_at")
  expect(history).toEqual([
    { event_type: "ARCHIVED", from_status: "ACTIVE", to_status: "ARCHIVED", actor_id: owner!.userId },
    { event_type: "RESTORED", from_status: "ARCHIVED", to_status: "ACTIVE", actor_id: owner!.userId },
  ])
  expect(await projectStatus(), "archive/restore doesn't touch approval").toBe("APPROVED")
})

test("6c. exported evidence is kept when removed; unexported evidence is deleted; exports archive, never delete", async () => {
  const page = await ownerFresh.newPage()
  await page.goto(`/projects/${projectId}/evidence`)

  // The uploaded file went into export v01, so removing it keeps it.
  const fileRow = page.getByTestId("current-evidence").locator("div.flex-wrap", { has: page.getByText(EVIDENCE_FILE_NAME) })
  await expect(fileRow.getByText("In an export")).toBeVisible()
  await fileRow.getByRole("button", { name: "Remove" }).click()
  await expect(fileRow.getByTestId("remove-evidence")).toContainText("part of an export, so it stays on record")
  await fileRow.getByLabel("Reason for removing").fill(`Superseded (${runId})`)
  await fileRow.getByRole("button", { name: "Remove (keep on record)" }).click()
  const removedCard = page.getByTestId("removed-evidence")
  await expect(removedCard).toContainText(EVIDENCE_FILE_NAME)
  await expect(removedCard).toContainText(`Superseded (${runId})`)
  const { data: kept } = await admin.from("evidence_items").select("removed_at, removal_reason, storage_path").eq("id", evidenceFileId).single()
  expect(kept!.removed_at).not.toBeNull()
  const stillDownloads = await page.request.get(`/projects/${projectId}/evidence/${evidenceFileId}/file`)
  expect(stillDownloads.status(), "a kept file stays downloadable").toBe(200)
  expect(Buffer.from(await stillDownloads.body()).equals(PNG_BYTES)).toBe(true)
  expect(await projectStatus(), "removing exported evidence invalidates the approval").toBe("READY_FOR_REVIEW")

  // A link added now is in no export: removing it deletes it.
  await page.getByLabel("Link (Drive, screenshot, report) *").fill(`https://example.com/${runId}/temporary`)
  await page.getByRole("button", { name: "Add evidence" }).click()
  const linkRow = page.getByTestId("current-evidence").locator("div.flex-wrap", { has: page.getByText(`https://example.com/${runId}/temporary`) })
  await expect(linkRow).toBeVisible()
  await expect(linkRow.getByText("In an export")).toHaveCount(0)
  await linkRow.getByRole("button", { name: "Remove" }).click()
  await expect(linkRow.getByTestId("remove-evidence")).toContainText("isn't in any export, so it will be deleted")
  await linkRow.getByLabel("Reason for removing").fill("Added by mistake")
  await linkRow.getByRole("button", { name: "Delete" }).click()
  await expect(page.getByText(`https://example.com/${runId}/temporary`)).toHaveCount(0)
  const { count: tempLeft } = await admin
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("external_url", `https://example.com/${runId}/temporary`)
  expect(tempLeft).toBe(0)

  // Export archiving: out of the main list, still downloadable, restorable.
  await page.goto(`/projects/${projectId}/readiness/exports/1`)
  await expect(page.getByRole("button", { name: "Archive export" }), "a reason is required").toBeDisabled()
  await page.getByLabel("Reason", { exact: true }).fill("Superseded by the next version")
  await page.getByRole("button", { name: "Archive export" }).click()
  await expect(page.getByRole("heading", { name: /Export package/ })).toContainText("Archived")
  const zip = await page.request.get(`/projects/${projectId}/readiness/exports/1/download`)
  expect(zip.status(), "an archived export still downloads").toBe(200)
  await page.goto(`/projects/${projectId}/readiness`)
  await expect(page.getByTestId("archived-exports")).toContainText("Archived exports (1)")
  await page.goto(`/projects/${projectId}/readiness/exports/1`)
  await expect(page.getByRole("button", { name: "Restore export" }), "a reason is required").toBeDisabled()
  await page.getByLabel("Reason", { exact: true }).fill("Needed again")
  await page.getByRole("button", { name: "Restore export" }).click()
  await expect(page.getByRole("heading", { name: /Export package/ })).not.toContainText("Archived")
  const { data: archiveEvents } = await admin.from("project_export_archive_events").select("event_type, reason, actor_id").order("seq")
    .in("export_id", (await admin.from("project_exports").select("id").eq("project_id", projectId)).data!.map((e) => e.id))
  expect(archiveEvents).toEqual([
    { event_type: "ARCHIVED", reason: "Superseded by the next version", actor_id: owner!.userId },
    { event_type: "RESTORED", reason: "Needed again", actor_id: owner!.userId },
  ])
})

test("7. approval is refused when password + TOTP auth is older than 5 minutes", async () => {
  // Invalidate through a real RPC so there is something to approve again.
  const { error } = await seedClient!.rpc("add_evidence_item", {
    p_project_id: projectId,
    p_category: "evidence",
    p_external_url: `https://example.com/${runId}/late-evidence`,
    p_verification_status: "UNVERIFIED",
  })
  expect(error).toBeNull()
  expect(await projectStatus()).toBe("READY_FOR_REVIEW")

  const staleAfter = firstPasswordAuthAt + 5 * 60_000 + 30_000
  const waitMs = staleAfter - Date.now()
  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for the first session's password auth to pass 5 minutes...`)
    await new Promise((r) => setTimeout(r, waitMs))
  }

  const page = await ownerFirst.newPage()
  await page.goto(`/projects/${projectId}/readiness`)
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/readiness$`))
  await page.getByRole("button", { name: "Approve & generate export" }).click()
  await expect(formError(page)).toContainText("fresh password + TOTP sign-in within the last 5 minutes")

  expect(await projectStatus()).toBe("READY_FOR_REVIEW")
  const { count } = await admin
    .from("project_exports")
    .select("version", { count: "exact", head: true })
    .eq("project_id", projectId)
  expect(count, "no export created by the refused approval").toBe(1)
})
