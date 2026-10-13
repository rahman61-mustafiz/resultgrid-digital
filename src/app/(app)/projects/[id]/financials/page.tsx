import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  computeClientProfit,
  computeResultGridProfit,
  type FinancialRecordRow,
} from "@/lib/finance/profit"
import {
  EVIDENCE_STATUSES,
  FINANCIAL_RECORD_TYPE_LABELS,
  FINANCIAL_RECORD_TYPES,
  VALUE_STATUSES,
  type FinancialRecordType,
} from "@/lib/domain/enums"
import { ListFilters } from "@/components/list-filters"
import { searchAny, param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { isIsoDate } from "@/lib/dates/periods"

const TYPE_FILTERS = ["all", ...FINANCIAL_RECORD_TYPES] as const
const VALUE_FILTERS = ["all", ...VALUE_STATUSES] as const
const EVIDENCE_FILTERS = ["all", ...EVIDENCE_STATUSES] as const
const SORTS = ["period_desc", "period_asc", "amount_desc", "amount_asc"] as const
import { FinancialRecordForm } from "@/app/(app)/projects/[id]/financials/financial-record-form"
import { RecordRow } from "@/app/(app)/projects/[id]/financials/record-row"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function ProfitCard({
  title,
  currency,
  result,
}: {
  title: string
  currency: string
  result: ReturnType<typeof computeClientProfit>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {result.status === "INCOMPLETE" ? (
          <>
            <Badge variant="outline">INCOMPLETE</Badge>
            <p className="text-sm text-muted-foreground">
              Missing:{" "}
              {result.missingCategories
                .map((t) => FINANCIAL_RECORD_TYPE_LABELS[t])
                .join(", ")}
              . Add at least one record in each category to calculate.
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-semibold">
              {currency} {result.amount.toLocaleString()}
            </p>
            {result.caveats.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {c}
              </p>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default async function FinancialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const { id } = await params
  const filters = await searchParams
  const q = searchText(filters)
  const typeFilter = pick(param(filters, "type"), TYPE_FILTERS, "all")
  const valueFilter = pick(param(filters, "value"), VALUE_FILTERS, "all")
  const evidenceFilter = pick(param(filters, "evidence"), EVIDENCE_FILTERS, "all")
  const sort = pick(param(filters, "sort"), SORTS, "period_desc")
  const from = isIsoDate(param(filters, "from")) ? param(filters, "from") : ""
  const to = isIsoDate(param(filters, "to")) ? param(filters, "to") : ""
  const filtered = !!(q || typeFilter !== "all" || valueFilter !== "all" || evidenceFilter !== "all" || from || to)
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name, default_currency")
    .eq("id", id)
    .maybeSingle()

  if (!project) {
    notFound()
  }

  const { data: records } = await supabase
    .from("financial_records")
    .select("*")
    .eq("project_id", id)
    .order("period_start", { ascending: false })

  const rows = (records ?? []) as unknown as FinancialRecordRow[]
  const resultGridProfit = computeResultGridProfit(rows)
  const clientProfit = computeClientProfit(rows)

  // The list below can be filtered; the profit above is always all records.
  let listQuery = supabase.from("financial_records").select("*").eq("project_id", id)
  if (q) listQuery = listQuery.or(searchAny(["notes", "evidence_url"], q))
  if (typeFilter !== "all") listQuery = listQuery.eq("record_type", typeFilter)
  if (valueFilter !== "all") listQuery = listQuery.eq("value_status", valueFilter)
  if (evidenceFilter !== "all") listQuery = listQuery.eq("evidence_status", evidenceFilter)
  // Records whose own period overlaps [from, to].
  if (from) listQuery = listQuery.gte("period_end", from)
  if (to) listQuery = listQuery.lte("period_start", to)
  listQuery = sort.startsWith("amount")
    ? listQuery.order("amount", { ascending: sort === "amount_asc" })
    : listQuery.order("period_start", { ascending: sort === "period_asc" })
  const { data: listed, error: listError } = await listQuery

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Financials &amp; results</h1>
          <p className="text-sm text-muted-foreground">{project.project_name}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${id}/financials/import`}>Import CSV</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ProfitCard
          title="ResultGrid Digital profit"
          currency={project.default_currency}
          result={resultGridProfit}
        />
        <ProfitCard
          title="Client profit"
          currency={project.default_currency}
          result={clientProfit}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a record</CardTitle>
        </CardHeader>
        <CardContent>
          <FinancialRecordForm projectId={id} currency={project.default_currency} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Records</h2>
        <p className="text-xs text-muted-foreground">
          Filters change this list only. The profit figures above always use every record of the project.
        </p>
        <ListFilters
          action={`/projects/${id}/financials`}
          searchLabel="Notes or evidence link"
          q={q}
          selects={[
            {
              name: "type",
              label: "Category",
              value: typeFilter,
              options: [{ value: "all", label: "All categories" }, ...FINANCIAL_RECORD_TYPES.map((t) => ({ value: t, label: FINANCIAL_RECORD_TYPE_LABELS[t] }))],
            },
            {
              name: "value",
              label: "Value status",
              value: valueFilter,
              options: [{ value: "all", label: "All" }, ...VALUE_STATUSES.map((s) => ({ value: s, label: s }))],
            },
            {
              name: "evidence",
              label: "Evidence",
              value: evidenceFilter,
              options: [{ value: "all", label: "All" }, ...EVIDENCE_STATUSES.map((s) => ({ value: s, label: s }))],
            },
            {
              name: "sort",
              label: "Sort",
              value: sort,
              options: [
                { value: "period_desc", label: "Period, newest first" },
                { value: "period_asc", label: "Period, oldest first" },
                { value: "amount_desc", label: "Amount, highest first" },
                { value: "amount_asc", label: "Amount, lowest first" },
              ],
            },
          ]}
          dates={[
            { name: "from", label: "Period from", value: from },
            { name: "to", label: "Period to", value: to },
          ]}
          resultCount={listError ? undefined : listed?.length ?? 0}
        />
        {listError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load the records. Reload the page to try again.
          </p>
        ) : filtered && (listed ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No records match these filters.</p>
        ) : null}
      </div>

      {FINANCIAL_RECORD_TYPES.map((type: FinancialRecordType) => {
        const typeRecords = (listed ?? []).filter((r) => r.record_type === type)
        if (typeRecords.length === 0) return null
        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="text-base">
                {FINANCIAL_RECORD_TYPE_LABELS[type]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {typeRecords.map((record) => (
                <RecordRow
                  key={record.id}
                  projectId={id}
                  record={record}
                  currency={project.default_currency}
                />
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
