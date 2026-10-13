import { cookies } from "next/headers"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildClientReport } from "@/lib/reports/client-report"
import { ClientReportView } from "@/lib/reports/report-view"
import { PeriodSelector } from "@/lib/reports/period-selector"
import { PinForm } from "@/app/share/[token]/pin-form"
import { isLinkExpired, isSessionNonceValid } from "@/lib/domain/share-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { token } = await params
  const { period } = await searchParams
  const admin = createAdminClient()

  const { data: link } = await admin
    .from("client_share_links")
    .select(
      "project_id, expires_at, revoked_at, session_nonce_hash, session_nonce_expires_at, report_rules_version"
    )
    .eq("token", token)
    .maybeSingle()

  if (!link || link.revoked_at || isLinkExpired(link.expires_at)) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Link not available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This link has expired or was revoked. Ask ResultGrid Digital for
              a new one.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const cookieStore = await cookies()
  const presentedNonce = cookieStore.get(`rg_share_${token}`)?.value

  // The cookie must both exist and hash to what verifySharePinAction
  // stored server-side after a correct PIN check -- a bare presence check
  // (the old behavior) would let anyone who has the link, but not the
  // PIN, set this cookie themselves and skip the PIN entirely.
  const verified = isSessionNonceValid(
    presentedNonce,
    link.session_nonce_hash,
    link.session_nonce_expires_at
  )

  if (!verified) {
    return <PinForm token={token} />
  }

  // The link's own calculation rules: a link never changes rules.
  const rules = link.report_rules_version === 1 ? 1 : 2
  const result = await buildClientReport(link.project_id, period, rules)

  if (!result.ok) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Report not available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {result.reason === "NOT_APPROVED"
                ? "This report is being updated and isn't ready to view yet. Please check back shortly."
                : "This report is currently unavailable."}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-muted/30 p-6">
      <div className="mx-auto mb-4 max-w-2xl">
        <PeriodSelector basePath={`/share/${token}`} activePeriod={result.report.periodKey} rules={rules} />
      </div>
      <ClientReportView report={result.report} />
    </div>
  )
}
