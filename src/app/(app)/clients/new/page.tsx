import { ClientBusinessForm } from "@/app/(app)/clients/client-form"
import { createClientBusinessAction } from "@/app/(app)/clients/actions"
import { getTimezoneOptions } from "@/lib/domain/timezones"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function NewClientBusinessPage() {
  const timezones = getTimezoneOptions()

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New client/business</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientBusinessForm
            action={createClientBusinessAction}
            timezones={timezones}
            submitLabel="Create"
          />
        </CardContent>
      </Card>
    </div>
  )
}
