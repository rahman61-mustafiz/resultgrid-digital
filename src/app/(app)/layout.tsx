import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { isViewOnlyDevice } from "@/lib/auth/edit-policy"
import { MOBILE_VIEW_ONLY_MESSAGE } from "@/lib/device"
import { SignOutButton } from "@/components/sign-out-button"
import { ViewOnlyGuard } from "@/components/view-only-guard"

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/projects", label: "Projects" },
  { href: "/leads", label: "Leads" },
  { href: "/reports", label: "Reports" },
  { href: "/files", label: "Files" },
  { href: "/exports", label: "Exports" },
  { href: "/settings", label: "Settings" },
]

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
      <header className="rg-glass sticky top-0 z-20 border-b border-[var(--sheet-border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-display text-lg font-semibold tracking-wide">ResultGrid Digital</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.email}
            </span>
            <SignOutButton />
          </div>
          <nav
            className="-mx-6 flex w-full items-center gap-5 overflow-x-auto px-6 pb-1"
            aria-label="Primary"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="shrink-0 rounded-md px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {viewOnly ? (
        <div
          role="status"
          data-testid="mobile-view-only"
          className="rg-glass border-b border-[var(--sheet-border)] px-6 py-2 text-center text-sm text-muted-foreground"
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
