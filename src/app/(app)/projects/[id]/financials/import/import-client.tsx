"use client"

import { useState, useTransition } from "react"
import Papa from "papaparse"

import {
  bulkImportFinancialRecordsAction,
  type ImportRow,
} from "@/app/(app)/projects/[id]/financials/actions"
import { financialRecordSchema } from "@/lib/domain/financial-record"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ParsedRow = ImportRow & { rowNumber: number; error: string | null }

const EXPECTED_HEADERS = [
  "recordType",
  "amount",
  "valueStatus",
  "periodStart",
  "periodEnd",
  "evidenceStatus",
  "evidenceUrl",
  "notes",
  "attributedToMarketing",
]

export function ImportClient({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFile(file: File) {
    setFileError(null)
    setResult(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setFileError(results.errors[0].message)
          return
        }
        const parsedRows: ParsedRow[] = results.data.map((raw, i) => {
          const candidate: ImportRow = {
            recordType: raw.recordType ?? "",
            amount: Number(raw.amount),
            valueStatus: raw.valueStatus ?? "",
            periodStart: raw.periodStart ?? "",
            periodEnd: raw.periodEnd ?? "",
            evidenceStatus: raw.evidenceStatus ?? "",
            evidenceUrl: raw.evidenceUrl ?? "",
            notes: raw.notes ?? "",
            attributedToMarketing: /^(true|yes|1)$/i.test((raw.attributedToMarketing ?? "").trim()),
          }
          const parsed = financialRecordSchema.safeParse(candidate)
          return {
            ...candidate,
            rowNumber: i + 2, // +1 for header row, +1 for 1-indexing
            error: parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid row"),
          }
        })
        setRows(parsedRows)
      },
      error: (err) => setFileError(err.message),
    })
  }

  const validRows = rows.filter((r) => !r.error)
  const invalidRows = rows.filter((r) => r.error)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Upload CSV</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Expected columns: {EXPECTED_HEADERS.join(", ")}. recordType/
            valueStatus/evidenceStatus must match the exact values used in the
            Financials form. Dates as YYYY-MM-DD.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          {fileError ? (
            <p className="text-sm text-destructive" role="alert">
              {fileError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              2. Review ({validRows.length} valid, {invalidRows.length} invalid)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left">Row</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Amount</th>
                    <th className="p-2 text-left">Period</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t">
                      <td className="p-2">{r.rowNumber}</td>
                      <td className="p-2">{r.recordType}</td>
                      <td className="p-2">{r.amount}</td>
                      <td className="p-2">
                        {r.periodStart} to {r.periodEnd}
                      </td>
                      <td className="p-2">
                        {r.error ? (
                          <Badge variant="destructive">{r.error}</Badge>
                        ) : (
                          <Badge variant="outline">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <Button
                type="button"
                disabled={isPending || validRows.length === 0}
                onClick={() => {
                  startTransition(async () => {
                    const res = await bulkImportFinancialRecordsAction(
                      projectId,
                      validRows
                    )
                    if (res.error !== null) {
                      setFileError(res.error)
                    } else {
                      setResult({ imported: res.imported })
                      setRows([])
                    }
                  })
                }}
              >
                {isPending
                  ? "Importing..."
                  : `3. Import ${validRows.length} valid row(s)`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <p className="text-sm text-green-600" role="status">
          Imported {result.imported} record(s).
        </p>
      ) : null}
    </div>
  )
}
