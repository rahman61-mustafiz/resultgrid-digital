"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import { logFollowupAction } from "@/app/(app)/leads/actions"
import { Button } from "@/components/ui/button"

export function FollowupButton({
  leadId,
  followupCount,
}: {
  leadId: string
  followupCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const maxed = followupCount >= 3

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending || maxed}
      onClick={() =>
        startTransition(async () => {
          await logFollowupAction(leadId)
          router.refresh()
        })
      }
    >
      {maxed
        ? "Max follow-ups reached"
        : isPending
          ? "Logging..."
          : `Log follow-up (${followupCount}/3)`}
    </Button>
  )
}
