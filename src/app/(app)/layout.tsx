import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { isViewOnlyDevice } from "@/lib/auth/edit-policy"
import { MOBILE_VIEW_ONLY_MESSAGE } from "@/lib/device"
import { SignOutButton } from "@/components/sign-out-button"
import { PrimaryNav } from "@/components/primary-nav"
import { ViewOnlyGuard } from "@/components/view-only-guard"

/** A small gear: the brand mark in the header. */
function BrandMark() {
  const teeth = 10
  const step = (Math.PI * 2) / teeth
  const pt = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`
  let d = ""
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    d += `${i ? "L" : "M"}${pt(8.4, a)} L${pt(11, a + step * 0.14)} L${pt(11, a + step * 0.4)} L${pt(8.4, a + step * 0.54)} `
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-primary">
      <path d={`${d}Z M16 12 A4 4 0 1 0 8 12 A4 4 0 1 0 16 12 Z`} fill="currentColor" fillRule="evenodd" />
      <circle cx="12" cy="12" r="1.6" fill="var(--signal)" />
    </svg>
  )
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const viewOnly = await isViewOnlyDevice()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="rg-glass sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-6 pt-4 pb-2">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="flex flex-col leading-none">
              <span className="font-display text-lg font-bold tracking-tight">ResultGrid</span>
              <span className="mt-1 text-[0.625rem] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Digital · Marketing OS</span>
            </span>
          </Link>
          <div className="order-2 flex items-center gap-3 lg:order-3">
            <span
              title={user?.email ?? undefined}
              className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            >
              <span aria-hidden="true">{(user?.email ?? "?").slice(0, 1).toUpperCase()}</span>
              <span className="sr-only">Signed in as {user?.email}</span>
            </span>
            <span className="hidden flex-col leading-tight sm:flex xl:hidden">
              <span className="text-sm font-semibold">Owner</span>
              <span className="text-xs text-muted-foreground">signed in</span>
            </span>
            <SignOutButton variant="ghost" />
          </div>
          <div className="order-3 -mx-6 w-full px-6 lg:order-2 lg:mx-0 lg:w-auto lg:flex-1 lg:px-0">
            <PrimaryNav />
          </div>
        </div>
      </header>
      {viewOnly ? (
        <div
          role="status"
          data-testid="mobile-view-only"
          className="rg-glass px-6 py-2 text-center text-sm text-muted-foreground"
        >
          View-only on this device. {MOBILE_VIEW_ONLY_MESSAGE}
        </div>
      ) : null}
      <main className="rg-sheet mx-auto my-4 w-[calc(100%-1.5rem)] max-w-6xl flex-1 px-4 py-6 sm:my-6 sm:px-8 sm:py-8">
        {viewOnly ? (
          // Disables every write control in the page; search and filter
          // (GET) forms and links still work. The proxy and every Server
          // Action refuse phone writes too; this only keeps the UI honest.
          <ViewOnlyGuard>{children}</ViewOnlyGuard>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
