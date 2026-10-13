"use client"

import { useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { completeRecoveryAction } from "@/app/recovery/callback/actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function RecoveryCallbackPage() {
  const [status, setStatus] = useState<"working" | "error">("working")
  const [message, setMessage] = useState("Verifying your recovery link...")
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const supabase = createClient()

    async function run() {
      // The Supabase browser client auto-detects the recovery tokens in
      // the URL (implicit hash fragment or PKCE `code` param) and
      // establishes a session on load; getSession() waits for that.
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        setStatus("error")
        setMessage(
          "This recovery link is invalid, expired, or already used. Request a new one from /recovery."
        )
        return
      }

      const result = await completeRecoveryAction()
      if (result?.error) {
        setStatus("error")
        setMessage(result.error)
      }
      // On success, completeRecoveryAction redirects server-side.
    }

    run()
  }, [])

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            {status === "error" ? "Recovery link problem" : "One moment..."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  )
}
