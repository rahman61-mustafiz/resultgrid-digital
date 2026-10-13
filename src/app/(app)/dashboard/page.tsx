import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { isFollowupDue } from "@/lib/domain/lead"
import {
  FINANCIAL_RECORD_TYPE_LABELS,
  FINANCIAL_RECORD_TYPES,
  LEAD_STAGES,
  TARGET_METRIC_LABELS,
  type FinancialRecordType,
  type TargetMetric,
} from "@/lib/domain/enums"
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  isDashboardPeriodKey,
  resolvePeriod,
  todayIn,
  type DateRange,
} from "@/lib/dates/periods"
import { compareTotals, profitByProject, summarizePeriod, targetProgress, type Change, type DashboardRecord } from "@/lib/finance/dashboard"
import type { ProfitResult } from "@/lib/finance/profit"
import { param, type SearchParams } from "@/lib/list-query"
import { DASHBOARD_CARDS, type DashboardCard } from "@/lib/dashboard-cards"
import { ListFilters } from "@/components/list-filters"
import { fetchAll, type FetchAllResult } from "@/lib/supabase/fetch-all"
import { saveDashboardCardsAction } from "@/app/(app)/dashboard/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function money(currency: string, amount: number) {
  return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
}

function totalsText(totals: Record<string, number>) {
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b))
  return entries.length ? entries.map(([c, a]) => money(c, a)).join(" + ") : "No records"
}

function ChangeText({ currency, change }: { currency: string; change: Change }) {
  if (change.kind === "no-previous") return <span>no records in the previous period</span>
  if (change.kind === "no-current") return <span>{money(currency, change.previous)} before; no records now</span>
  const sign = change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±"
  return (
    <span>
      {sign}
      {money(currency, Math.abs(change.delta))}
      {change.percent === null ? "" : ` (${sign}${Math.abs(change.percent).toFixed(1)}%)`}
    </span>
  )
}

function ProfitCell({ result, currency }: { result: ProfitResult; currency: string }) {
  if (result.status === "INCOMPLETE") {
    return (
      <span className="flex flex-col gap-1">
        <Badge variant="outline" className="w-fit">
          INCOMPLETE
        </Badge>
        <span className="text-xs text-muted-foreground">
          Missing: {result.missingCategories.map((t) => FINANCIAL_RECORD_TYPE_LABELS[t]).join(", ")}
        </span>
      </span>
    )
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">{money(currency, result.amount)}</span>
      {result.caveats.length ? (
        <span className="text-xs text-muted-foreground">{result.caveats.length} note(s) on the Financials page</span>
      ) : null}
    </span>
  )
}

function rangeText(r: DateRange) {
  return r.start === r.end ? r.start : `${r.start} to ${r.end}`
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: workspace, error: workspaceError } = await supabase.from("workspaces").select("id, name, default_timezone").maybeSingle()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: prefs } = user
    ? await supabase.from("dashboard_preferences").select("hidden_cards").eq("user_id", user.id).maybeSingle()
    : { data: null }
  const hidden = new Set<string>(prefs?.hidden_cards ?? [])
  const show = (card: DashboardCard) => !hidden.has(card)

  // Every query is read in full (fetchAll); a failed or truncated read makes
  // the cards that depend on it "unavailable", never a partial total or 0.
  const projectsRes = await fetchAll((a, b) =>
    supabase
      .from("projects")
      .select("id, project_name, default_currency, timezone, lifecycle_status, readiness_status, client_businesses(display_name)")
      .order("id")
      .range(a, b),
  )
  const projects = [...projectsRes.rows].sort((x, y) => x.project_name.localeCompare(y.project_name))
  const projectParam = param(params, "project")
  const projectId = UUID.test(projectParam) ? projectParam : ""
  const selectedProject = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null

  // One project: its own timezone, the same rule its client report uses.
  // All projects: the workspace timezone. If the timezone that applies
  // couldn't be loaded, nothing date-based is computed: every period, and so
  // every figure that depends on one, is shown as unavailable.
  const knownTimeZone = projectId
    ? projectsRes.ok && selectedProject?.timezone
      ? selectedProject.timezone
      : null
    : !workspaceError && workspace?.default_timezone
      ? workspace.default_timezone
      : null
  const tzOk = knownTimeZone !== null
  // Only to draw the period picker when the real timezone is unknown.
  const timeZone = knownTimeZone ?? "Asia/Dhaka"
  const periodParam = param(params, "period")
  const periodKey = isDashboardPeriodKey(periodParam) ? periodParam : "this_month"
  const from = param(params, "from")
  const to = param(params, "to")
  const resolved = resolvePeriod({ key: periodKey, from, to }, timeZone, new Date())
  const fallback = resolvePeriod({ key: "this_month" }, timeZone, new Date())
  const period = resolved.ok ? resolved.period : fallback.ok ? fallback.period : null
  if (!period) throw new Error("Could not resolve the dashboard period.")

  // Every record touching either period (inside or straddling a boundary).
  const recordsRes = await fetchAll((a, b) => {
    let q = supabase
      .from("financial_records")
      .select("id, project_id, record_type, amount, value_status, attributed_to_marketing, evidence_status, period_start, period_end")
      .gte("period_end", period.previous.start)
      .lte("period_start", period.current.end)
    if (projectId) q = q.eq("project_id", projectId)
    return q.order("id").range(a, b)
  })
  const moneyOk = projectsRes.ok && recordsRes.ok && tzOk

  const currencyOf = new Map(projects.map((p) => [p.id, p.default_currency]))
  const records: DashboardRecord[] = moneyOk
    ? recordsRes.rows.map((r) => ({
        ...r,
        record_type: r.record_type as FinancialRecordType,
        value_status: r.value_status as DashboardRecord["value_status"],
        currency: currencyOf.get(r.project_id) ?? "?",
      }))
    : []
  const current = summarizePeriod(records, period.current)
  const previous = summarizePeriod(records, period.previous)

  const profitProjects = projects
    .filter((p) => (projectId ? p.id === projectId : records.some((r) => r.project_id === p.id)))
    .map((p) => ({ id: p.id, currency: p.default_currency }))
  const profits = profitByProject(records, profitProjects, period.current)
  const projectName = new Map(projects.map((p) => [p.id, p.project_name]))

  const targetsRes = await fetchAll((a, b) => {
    let q = supabase
      .from("project_targets")
      .select("id, project_id, metric, unit, target, actual, baseline, period_start, period_end")
      .lte("period_start", period.current.end)
      .gte("period_end", period.current.start)
    if (projectId) q = q.eq("project_id", projectId)
    return q.order("id").range(a, b)
  })
  // Targets need project names and the right period.
  const targetsOk = targetsRes.ok && projectsRes.ok && tzOk
  const targets = targetsOk
    ? targetProgress(targetsRes.rows, period.current).sort((x, y) => x.period_start.localeCompare(y.period_start))
    : []

  const { count: clientCount, error: clientCountError } = await supabase
    .from("client_businesses")
    .select("id", { count: "exact", head: true })
    .eq("status", "ACTIVE")
  const openProjects = projects.filter((p) => p.lifecycle_status !== "ARCHIVED")
  const leadsRes = await fetchAll((a, b) =>
    supabase
      .from("leads")
      .select("id, name, stage, followup_count, last_followup_at, created_at, archived_at")
      .is("archived_at", null)
      .order("id")
      .range(a, b),
  )
  const leads = leadsRes.ok ? leadsRes.rows : []
  // New leads per period also need the timezone; counts by stage don't.
  const leadPeriodsOk = leadsRes.ok && tzOk
  const leadDate = (iso: string) => todayIn(timeZone, new Date(iso))
  const leadsIn = (r: DateRange) => leads.filter((l) => leadDate(l.created_at) >= r.start && leadDate(l.created_at) <= r.end)
  const newLeads = leadsIn(period.current)
  const newLeadsBefore = leadsIn(period.previous)
  const followupsDue = leads.filter(isFollowupDue)
  // Never listed from a partial read.
  const unready = projectsRes.ok ? openProjects.filter((p) => p.readiness_status !== "APPROVED") : []

  const why = (r: FetchAllResult<unknown>) =>
    r.ok ? "" : r.reason === "too-many" ? `are too many to load completely (${r.message})` : `could not be loaded (${r.message})`

  // Truthfulness warnings: always shown, never a hideable card.
  const warnings: string[] = []
  if (!tzOk)
    warnings.push(
      projectId && projectsRes.ok && !selectedProject
        ? "The selected project was not found, so its timezone is unknown: every date-based figure is unavailable. Choose another project."
        : `The ${projectId ? "project's" : "workspace's"} timezone could not be loaded, so periods can't be worked out: money, profit, targets and new leads are unavailable.`,
    )
  if (!projectsRes.ok)
    warnings.push(`Projects ${why(projectsRes)}: project counts, money, profit, targets and items needing attention are unavailable.`)
  if (!recordsRes.ok) warnings.push(`Financial records ${why(recordsRes)}: money and profit are unavailable, not zero.`)
  if (!targetsRes.ok) warnings.push(`Targets ${why(targetsRes)}: target progress is unavailable.`)
  if (!leadsRes.ok) warnings.push(`Leads ${why(leadsRes)}: lead figures are unavailable.`)
  if (clientCountError) warnings.push("The client count could not be loaded.")
  if (!resolved.ok) warnings.push(`${resolved.error} Showing this month instead.`)
  if (period.elapsedDays < period.totalDays && period.elapsedDays > 0)
    warnings.push(
      `${period.label} is in progress (day ${period.elapsedDays} of ${period.totalDays}); it is compared with the whole previous period.`,
    )
  if (current.spanning + previous.spanning > 0)
    warnings.push(
      `${current.spanning} record(s) in this period and ${previous.spanning} in the previous one cover dates both inside and outside it. They are left out, not split or counted whole — narrow or widen the period to include them.`,
    )
  const excluded = (s: typeof current) => FINANCIAL_RECORD_TYPES.reduce((n, t) => n + s.categories[t].pending + s.categories[t].disputed, 0)
  const estimated = FINANCIAL_RECORD_TYPES.reduce((n, t) => n + current.categories[t].estimated, 0)
  if (excluded(current) > 0) warnings.push(`${excluded(current)} pending or disputed record(s) are excluded from the totals.`)
  if (estimated > 0) warnings.push(`${estimated} record(s) in the totals are ESTIMATED, not confirmed.`)
  if (current.unverified > 0) warnings.push(`${current.unverified} record(s) in the totals have UNVERIFIED evidence.`)
  const currencies = new Set(records.map((r) => r.currency))
  if (currencies.size > 1) warnings.push("Several currencies are involved; totals are shown per currency and never added together.")
  warnings.push("Figures come from manually entered records. A category with no records shows “No records”, never zero.")

  const comparisonLabel = `${rangeText(period.current)} compared with ${rangeText(period.previous)}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {workspace ? <p className="text-sm text-muted-foreground">{workspace.name}</p> : null}
      </div>

      <ListFilters
        action="/dashboard"
        selects={[
          {
            name: "project",
            label: "Project",
            value: projectId,
            options: [
              { value: "", label: "All projects" },
              ...projects.map((p) => ({ value: p.id, label: `${p.project_name} (${p.client_businesses?.display_name ?? ""})` })),
            ],
          },
          {
            name: "period",
            label: "Period",
            value: period.key,
            options: DASHBOARD_PERIODS.map((k) => ({ value: k, label: DASHBOARD_PERIOD_LABELS[k] })),
          },
        ]}
        dates={[
          { name: "from", label: "Custom from", value: periodKey === "custom" ? from : "" },
          { name: "to", label: "Custom to", value: periodKey === "custom" ? to : "" },
        ]}
      />

      <p className="text-sm" data-testid="dashboard-period">
        <span className="font-medium">{period.label}</span>: {tzOk ? comparisonLabel : "dates unavailable (timezone unknown)"}
        {selectedProject ? ` · ${selectedProject.project_name}` : projectId ? " · selected project" : " · all projects"}
        {tzOk ? ` · dates in ${timeZone}` : ""}
      </p>

      <Card data-testid="dashboard-warnings" className="border-amber-300 dark:border-amber-700">
        <CardHeader>
          <CardTitle className="text-base">Read these figures with care</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {show("overview") ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="card-overview">
          <Card>
            <CardHeader>
              <CardTitle>{clientCountError ? "Unavailable" : (clientCount ?? 0)}</CardTitle>
              <CardDescription>Active clients &amp; businesses</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{projectsRes.ok ? openProjects.length : "Unavailable"}</CardTitle>
              <CardDescription>Projects not archived</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{leadsRes.ok ? leads.length : "Unavailable"}</CardTitle>
              <CardDescription>Active leads</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{leadsRes.ok ? followupsDue.length : "Unavailable"}</CardTitle>
              <CardDescription>Leads due for follow-up</CardDescription>
            </CardHeader>
          </Card>
        </div>
      ) : null}

      {show("money") ? (
        <Card data-testid="card-money">
          <CardHeader>
            <CardTitle className="text-base">Money in and out</CardTitle>
            <CardDescription>{comparisonLabel}. Confirmed and estimated amounts, less refunds.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!moneyOk ? (
              <p className="text-sm text-destructive" role="alert" data-testid="money-unavailable">
                Money figures unavailable: the data could not be loaded completely. See the warnings above.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-normal">Category</th>
                    <th className="py-2 pr-4 font-normal">This period</th>
                    <th className="py-2 pr-4 font-normal">Previous period</th>
                    <th className="py-2 font-normal">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {FINANCIAL_RECORD_TYPES.map((t) => {
                    const a = current.categories[t]
                    const b = previous.categories[t]
                    const changes = compareTotals(a, b)
                    const notes = [
                      a.estimated ? `${a.estimated} estimated` : "",
                      a.pending ? `${a.pending} pending excluded` : "",
                      a.disputed ? `${a.disputed} disputed excluded` : "",
                    ].filter(Boolean)
                    return (
                      <tr key={t} data-testid={`money-${t}`}>
                        <td className="py-2 pr-4">{FINANCIAL_RECORD_TYPE_LABELS[t]}</td>
                        <td className="py-2 pr-4">
                          {totalsText(a.totals)}
                          {notes.length ? <span className="block text-xs text-muted-foreground">{notes.join(", ")}</span> : null}
                        </td>
                        <td className="py-2 pr-4">{totalsText(b.totals)}</td>
                        <td className="py-2">
                          {Object.keys(changes).length === 0 ? (
                            <span className="text-muted-foreground">No records in either period</span>
                          ) : (
                            Object.entries(changes).map(([cur, ch]) => (
                              <span key={cur} className="block">
                                <ChangeText currency={cur} change={ch} />
                              </span>
                            ))
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {show("profit") ? (
        <Card data-testid="card-profit">
          <CardHeader>
            <CardTitle className="text-base">Profit by project</CardTitle>
            <CardDescription>
              {rangeText(period.current)}. Only records inside the period; INCOMPLETE when a required input has no record.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!moneyOk ? (
              <p className="text-sm text-destructive" role="alert" data-testid="profit-unavailable">
                Profit unavailable: the data could not be loaded completely. See the warnings above.
              </p>
            ) : profits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No financial records in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-normal">Project</th>
                    <th className="py-2 pr-4 font-normal">ResultGrid Digital profit (internal)</th>
                    <th className="py-2 font-normal">Client profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {profits.map((p) => (
                    <tr key={p.projectId} data-testid="profit-row">
                      <td className="py-2 pr-4 align-top">
                        <Link href={`/projects/${p.projectId}/financials`} className="underline">
                          {projectName.get(p.projectId)}
                        </Link>
                        {p.spanning ? (
                          <span className="block text-xs text-muted-foreground">{p.spanning} record(s) span the period edge, left out</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <ProfitCell result={p.resultGrid} currency={p.currency} />
                      </td>
                      <td className="py-2 align-top">
                        <ProfitCell result={p.client} currency={p.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {show("targets") ? (
        <Card data-testid="card-targets">
          <CardHeader>
            <CardTitle className="text-base">Target progress</CardTitle>
            <CardDescription>Targets whose own period overlaps {rangeText(period.current)}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!targetsOk ? (
              <p className="text-sm text-destructive" role="alert" data-testid="targets-unavailable">
                Target progress unavailable: the data could not be loaded completely. See the warnings above.
              </p>
            ) : targets.length === 0 ? (
              <p className="text-muted-foreground">No targets in this period.</p>
            ) : (
              targets.map((t, i) => (
                <div key={i} className="flex flex-col gap-1" data-testid="target-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{TARGET_METRIC_LABELS[t.metric as TargetMetric] ?? t.metric}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {projectName.get(t.project_id)} · {t.period_start} to {t.period_end}
                      </span>
                    </span>
                    <span>
                      {t.actual === null ? "Actual not recorded" : `${t.actual} ${t.unit}`} / target {t.target} {t.unit}
                      {t.percent !== null ? ` (${Math.round(t.percent)}%)` : ""}
                    </span>
                  </div>
                  {t.percent !== null ? (
                    <div
                      className="h-2 w-full overflow-hidden rounded bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.round(t.percent))}
                      aria-label={`${TARGET_METRIC_LABELS[t.metric as TargetMetric] ?? t.metric} progress`}
                    >
                      <div
                        className="h-full bg-primary transition-[width] duration-700 motion-reduce:transition-none"
                        style={{ width: `${Math.min(100, Math.max(0, t.percent))}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {show("leads") ? (
        <Card data-testid="card-leads">
          <CardHeader>
            <CardTitle className="text-base">Leads</CardTitle>
            <CardDescription>All projects (leads are not linked to a project). Archived leads are not counted.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {!leadsRes.ok ? (
              <p className="text-sm text-destructive" role="alert" data-testid="leads-unavailable">
                Lead figures unavailable: the data could not be loaded completely. See the warnings above.
              </p>
            ) : (
              <>
                {leadPeriodsOk ? (
                  <p data-testid="new-leads">
                    New leads: <span className="font-medium">{newLeads.length}</span> in {rangeText(period.current)},{" "}
                    {newLeadsBefore.length} in {rangeText(period.previous)}.
                  </p>
                ) : (
                  <p className="text-destructive" role="alert" data-testid="new-leads-unavailable">
                    New leads per period unavailable: the timezone could not be loaded.
                  </p>
                )}
                <p className="text-muted-foreground">
                  By stage now: {LEAD_STAGES.map((s) => `${s} ${leads.filter((l) => l.stage === s).length}`).join(" · ")}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {show("attention") ? (
        <Card data-testid="card-attention">
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {!projectsRes.ok ? (
              <p className="text-destructive" role="alert" data-testid="attention-projects-unavailable">
                Projects awaiting readiness or approval: unavailable, the projects could not be loaded completely.
              </p>
            ) : null}
            {!leadsRes.ok ? (
              <p className="text-destructive" role="alert" data-testid="attention-leads-unavailable">
                Follow-ups due: unavailable, the leads could not be loaded completely.
              </p>
            ) : null}
            {projectsRes.ok && leadsRes.ok && unready.length === 0 && followupsDue.length === 0 ? (
              <p className="text-muted-foreground">Nothing needs attention.</p>
            ) : null}
            {unready.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}/readiness`} className="underline">
                {p.project_name} &mdash; {p.readiness_status}
              </Link>
            ))}
            {followupsDue.map((l) => (
              <Link key={l.id} href={`/leads/${l.id}`} className="underline">
                {l.name} &mdash; follow-up due
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <details className="rounded-md border px-4 py-3 text-sm" data-testid="customize-dashboard">
        <summary className="cursor-pointer font-medium">Customize dashboard</summary>
        <form action={saveDashboardCardsAction} className="mt-3 flex flex-col gap-2">
          {DASHBOARD_CARDS.map((c) => (
            <label key={c.key} className="flex items-center gap-2">
              <input type="checkbox" name="show" value={c.key} defaultChecked={show(c.key)} />
              {c.label}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">The warnings above always show.</p>
          <div>
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </div>
        </form>
      </details>
    </div>
  )
}
