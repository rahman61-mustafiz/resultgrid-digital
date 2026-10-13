import Link from "next/link"

import { reportPeriodOptions, type ReportRulesVersion } from "@/lib/reports/report-rules"
import { Badge } from "@/components/ui/badge"

/**
 * Plain links (not a client-side <select>) so this works identically on
 * the public share page, which has no JS-driven state and must keep
 * working even if the viewer's browser blocks scripts.
 */
export function PeriodSelector({
  basePath,
  activePeriod,
  rules,
  extraQuery = "",
}: {
  basePath: string
  activePeriod: string
  rules: ReportRulesVersion
  /** Kept on every link, e.g. "rules=1" on the Owner's legacy preview. */
  extraQuery?: string
}) {
  const href = (key: string) => {
    const q = [key === "all" ? "" : `period=${key}`, extraQuery].filter(Boolean).join("&")
    return q ? `${basePath}?${q}` : basePath
  }
  return (
    <div className="flex flex-wrap gap-2">
      {reportPeriodOptions(rules).map(({ key, label }) => (
        <Link key={key} href={href(key)}>
          <Badge variant={key === activePeriod ? "default" : "outline"} className="cursor-pointer">
            {label}
          </Badge>
        </Link>
      ))}
    </div>
  )
}
