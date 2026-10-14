"use client"

import { useActionState } from "react"
import Link from "next/link"

import { requestPasswordResetAction, type ForgotPasswordState } from "@/app/forgot-password/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: ForgotPasswordState = null

const LINK_PROBLEMS: Record<string, string> = {
  expired: "That reset link has expired or was already used. Request a new one.",
  invalid: "That reset link isn't valid. Request a new one.",
  timeout: "The reset took longer than 15 minutes. Request a new link.",
}

export function ForgotPasswordForm({ link }: { link?: string }) {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, initialState)
  const linkProblem = LINK_PROBLEMS[link ?? ""]

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Reset your password</CardTitle>
          <CardDescription>
            We&apos;ll email you a link. After opening it you&apos;ll enter your authenticator code, then choose a new password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {linkProblem && !state?.sent ? (
            <p className="text-sm text-destructive" role="alert" data-testid="reset-link-problem">
              {linkProblem}
            </p>
          ) : null}
          {state?.sent ? (
            <p className="text-sm" role="status" data-testid="reset-sent">
              If that email belongs to an account, a reset link is on its way. It works once and expires in an hour. Check your spam
              folder too.
            </p>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {state?.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.error}
                </p>
              ) : null}
              <Button type="submit" disabled={isPending}>
                {isPending ? "Sending..." : "Email me a reset link"}
              </Button>
            </form>
          )}
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="underline">
              Back to sign in
            </Link>
            {" · "}
            <Link href="/recovery" className="underline">
              Lost your authenticator app?
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
