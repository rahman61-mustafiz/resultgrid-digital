import { LeadForm } from "@/app/(app)/leads/lead-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New lead</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadForm />
        </CardContent>
      </Card>
    </div>
  )
}
