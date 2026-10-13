#!/usr/bin/env node
/**
 * Renders the real dashboard server component (src/app/(app)/dashboard/page.tsx)
 * against an injected Supabase client, one failure at a time, and checks
 * which cards show figures and which say "unavailable"
 * (BUILD_READINESS_QUESTIONNAIRE.md I07: missing data shows a clear
 * explanation, never a misleading figure). No database access.
 *
 * Approach borrowed from scripts/qa-priority10-review.mjs: the module is
 * transpiled with TypeScript and loaded with its imports resolved by hand,
 * so the Supabase client and UI components can be replaced.
 *
 *   node scripts/qa-dashboard-failure-states.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"

const nativeRequire = createRequire(import.meta.url)
const PROJECT = "11111111-1111-4111-8111-111111111111"
const today = new Date().toISOString().slice(0, 10)

const OK_DATA = {
  workspaces: { data: { id: "w", name: "QA", default_timezone: "Asia/Dhaka" }, error: null },
  projects: {
    data: [
      { id: PROJECT, project_name: "QA Project", default_currency: "BDT", timezone: "Asia/Dhaka", lifecycle_status: "ACTIVE", readiness_status: "INCOMPLETE", client_businesses: { display_name: "QA Client" } },
    ],
    error: null,
  },
  financial_records: {
    data: [
      { id: "r1", project_id: PROJECT, record_type: "CLIENT_PAYMENT_RECEIVED", amount: 100, value_status: "CONFIRMED", attributed_to_marketing: false, evidence_status: "VERIFIED", period_start: today, period_end: today },
    ],
    error: null,
  },
  project_targets: {
    data: [{ id: "t1", project_id: PROJECT, metric: "LEADS", unit: "leads", target: 10, actual: 5, baseline: null, period_start: today, period_end: today }],
    error: null,
  },
  leads: { data: [{ id: "l1", name: "QA Lead", stage: "NEW", followup_count: 0, last_followup_at: null, created_at: new Date().toISOString(), archived_at: null }], error: null },
  client_businesses: { data: null, count: 1, error: null },
  dashboard_preferences: { data: null, error: null },
}

function clientWith(failing) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    from(table) {
      const ok = OK_DATA[table] ?? { data: [], error: null }
      const result = failing.includes(table) ? { data: null, count: null, error: { message: `injected ${table} failure` } } : ok
      // fetchAll pages: a second page (from > 0) is empty.
      let from = 0
      const query = new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "then") {
              const page = Array.isArray(result.data) && from > 0 ? { ...result, data: [] } : result
              return (resolve) => Promise.resolve(page).then(resolve)
            }
            if (key === "range") return (a) => ((from = a), query)
            return () => query
          },
        }
      )
      return query
    },
  }
}

let currentClient = clientWith([])
const cache = new Map()
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const req = (name) => {
    if (name === "@/lib/supabase/server") return { createClient: async () => currentClient }
    if (name === "@/app/(app)/dashboard/actions") return { saveDashboardCardsAction() {} }
    if (name.startsWith("@/components/") || name === "next/link")
      return new Proxy({ __esModule: true }, { get: (_, key) => (key === "__esModule" ? true : key) })
    if (!name.startsWith("@/") && !name.startsWith(".")) return nativeRequire(name)
    const base = name.startsWith("@/") ? path.resolve("src", name.slice(2)) : path.resolve(path.dirname(file), name)
    return load([".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find(fs.existsSync) ?? base)
  }
  new Function("require", "module", "exports", code)(req, mod, mod.exports)
  return mod.exports
}
const Dashboard = load("src/app/(app)/dashboard/page.tsx").default

async function render(failing, searchParams = {}) {
  currentClient = clientWith(failing)
  const tree = await Dashboard({ searchParams: Promise.resolve(searchParams) })
  const ids = new Set()
  const text = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node === "string" || typeof node === "number") return text.push(String(node))
    if (!node || typeof node !== "object") return
    if (node.props?.["data-testid"]) ids.add(node.props["data-testid"])
    walk(node.props?.children)
  }
  walk(tree)
  return { ids, text: text.join(" ") }
}

let failures = 0
function check(label, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}`)
  if (!condition) failures += 1
}

const shows = (r, id) => r.ids.has(id)
const FIGURES = ["money-CLIENT_PAYMENT_RECEIVED", "profit-row", "target-row", "new-leads"]

console.log("All data loads")
let r = await render([])
for (const id of FIGURES) check(`${id} shown`, shows(r, id))
check("no unavailable notices", ![...r.ids].some((id) => id.endsWith("unavailable")))

console.log("\nProjects fail")
r = await render(["projects"])
for (const id of ["money-unavailable", "profit-unavailable", "targets-unavailable", "attention-projects-unavailable"]) check(`${id}`, shows(r, id))
for (const id of ["money-CLIENT_PAYMENT_RECEIVED", "profit-row", "target-row"]) check(`${id} not shown`, !shows(r, id))
check("attention card still shown", shows(r, "card-attention"))
check("lead figures still shown (they don't depend on projects)", shows(r, "new-leads"))

console.log("\nWorkspace (timezone) fails, all projects")
r = await render(["workspaces"])
for (const id of ["money-unavailable", "profit-unavailable", "targets-unavailable", "new-leads-unavailable"]) check(`${id}`, shows(r, id))
check("no date-based figure shown", !FIGURES.some((id) => shows(r, id)))
check("warning names the timezone", r.text.includes("timezone could not be loaded"))

console.log("\nWorkspace fails, one project selected (its own timezone applies)")
r = await render(["workspaces"], { project: PROJECT })
for (const id of FIGURES) check(`${id} shown`, shows(r, id))

console.log("\nProjects fail, one project selected (its timezone is unknown)")
r = await render(["projects"], { project: PROJECT })
for (const id of ["money-unavailable", "targets-unavailable", "new-leads-unavailable"]) check(`${id}`, shows(r, id))

console.log("\nFinancial records fail")
r = await render(["financial_records"])
check("money unavailable", shows(r, "money-unavailable"))
check("profit unavailable", shows(r, "profit-unavailable"))
check("targets still shown", shows(r, "target-row"))

console.log("\nTargets fail")
r = await render(["project_targets"])
check("targets unavailable", shows(r, "targets-unavailable"))
check("money still shown", shows(r, "money-CLIENT_PAYMENT_RECEIVED"))

console.log("\nLeads fail")
r = await render(["leads"])
check("lead figures unavailable", shows(r, "leads-unavailable"))
check("follow-ups unavailable in Needs attention", shows(r, "attention-leads-unavailable"))
check("overview says Unavailable, not 0", r.text.includes("Unavailable"))

console.log(failures ? `\n${failures} failed.` : "\nAll passed.")
process.exit(failures ? 1 : 0)
