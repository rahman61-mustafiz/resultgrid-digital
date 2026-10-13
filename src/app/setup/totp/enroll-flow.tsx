"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import {
  startTotpEnrollmentAction,
  verifyTotpEnrollmentAction,
  type EnrollTotpState,
  type StartEnrollmentResult,
} from "@/app/setup/totp/actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialVerifyState: EnrollTotpState = null

export function EnrollTotpFlow() {
  const router = useRouter()
  const [enrollment, setEnrollment] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; factorId: string; qrCodeDataUrl: string; secret: string }
  >({ status: "loading" })

  // Runs exactly once per mount, independent of any later re-render caused
  // by a failed verify attempt -- see startTotpEnrollmentAction's comment.
  useEffect(() => {
    let cancelled = false
    startTotpEnrollmentAction().then((result: StartEnrollmentResult) => {
      if (cancelled) return
      if (result.ok) {
        setEnrollment({
          status: "ready",
          factorId: result.factorId,
          qrCodeDataUrl: result.qrCodeDataUrl,
          secret: result.secret,
        })
      } else if (result.error === "ALREADY_ENROLLED") {
        router.push("/login/verify")
      } else {
        setEnrollment({ status: "error", message: result.error })
      }
    })
    return () => {
      cancelled = true
    }
  }, [router])

  const [state, formAction, isPending] = useActionState(
    verifyTotpEnrollmentAction,
    initialVerifyState
  )

  if (enrollment.status === "loading") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Setting up your authenticator</CardTitle>
          <CardDescription>One moment...</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (enrollment.status === "error") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
          <CardDescription>{enrollment.message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Set up your authenticator app</CardTitle>
        <CardDescription>
          Required before you can access workspace data. Scan this code with
          Google Authenticator or another compatible app, then enter the
          6-digit code it shows.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex justify-center rounded-md border bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI QR code, not an optimizable remote/static asset */}
          <img
            src={enrollment.qrCodeDataUrl}
            alt="Authenticator app QR code"
            width={180}
            height={180}
          />
        </div>
        <div className="flex flex-col gap-1 text-center">
          <p className="text-xs text-muted-foreground">
            Can&apos;t scan? Enter this key manually:
          </p>
          <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            {enrollment.secret}
          </p>
        </div>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="factorId" value={enrollment.factorId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Authenticator code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              autoFocus
            />
          </div>
          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Verifying..." : "Confirm and continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
