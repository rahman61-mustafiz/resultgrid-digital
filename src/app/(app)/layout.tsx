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
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <span className="font-semibold">ResultGrid Digital</span>
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
                className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
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
          className="border-b bg-muted px-6 py-2 text-center text-sm text-muted-foreground"
        >
          View-only on this device. {MOBILE_VIEW_ONLY_MESSAGE}
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
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
