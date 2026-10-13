"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { createShareLinkAction } from "@/app/(app)/projects/[id]/share-links/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function CreateLinkButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ token: string; pin: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shareUrl = result
    ? `${window.location.origin}/share/${result.token}`
    : ""

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const res = await createShareLinkAction(projectId)
              if (res.error !== null) {
                setError(res.error)
              } else {
                setResult({ token: res.token, pin: res.pin })
              }
              router.refresh()
            })
          }}
        >
          {isPending ? "Creating..." : "Create new share link"}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <Card>
          <CardContent className="flex flex-col gap-2 py-4 text-sm">
            <p className="font-medium">
              Share this with the client now -- the PIN won&apos;t be shown again.
            </p>
            <p className="break-all">
              Link: <span className="font-mono">{shareUrl}</span>
            </p>
            <p>
              PIN: <span className="font-mono text-base">{result.pin}</span>
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
