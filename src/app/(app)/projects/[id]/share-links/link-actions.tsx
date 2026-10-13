"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import {
  extendShareLinkAction,
  revokeShareLinkAction,
} from "@/app/(app)/projects/[id]/share-links/actions"
import { Button } from "@/components/ui/button"

export function LinkActions({
  linkId,
  projectId,
  isRevoked,
}: {
  linkId: string
  projectId: string
  isRevoked: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await extendShareLinkAction(linkId, projectId)
            router.refresh()
          })
        }
      >
        Extend
      </Button>
      {!isRevoked ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await revokeShareLinkAction(linkId, projectId)
              router.refresh()
            })
          }
        >
          Revoke
        </Button>
      ) : null}
    </div>
  )
}
