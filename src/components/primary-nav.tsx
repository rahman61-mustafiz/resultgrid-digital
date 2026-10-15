"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BriefcaseBusiness,
  Building2,
  ChartColumn,
  FileDown,
  FolderOpen,
  LayoutGrid,
  Settings,
  UserRoundSearch,
} from "lucide-react"

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/projects", label: "Projects", icon: BriefcaseBusiness },
  { href: "/leads", label: "Leads", icon: UserRoundSearch },
  { href: "/reports", label: "Reports", icon: ChartColumn },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/exports", label: "Exports", icon: FileDown },
  { href: "/settings", label: "Settings", icon: Settings },
]

/** The main sections; the current one sits on a white pill. */
export function PrimaryNav() {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto pb-1 lg:justify-center" aria-label="Primary">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              current
                ? "bg-white text-primary shadow-[0_6px_18px_-10px_rgb(15_42_67/0.4)]"
                : "text-foreground/75 hover:bg-white/60 hover:text-foreground"
            }`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
