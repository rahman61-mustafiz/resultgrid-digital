"use client"

import { useLayoutEffect, useRef } from "react"

/**
 * The phone layout is view-only (BUILD_READINESS_QUESTIONNAIRE.md I08).
 * Every form control in the page is disabled, except those that only read:
 * controls inside a GET form (search, filters, period pickers) or marked
 * `data-read-control`. A disabled <fieldset> can't make that exception (it
 * disables every descendant), hence this guard. Before hydration, CSS in
 * globals.css already blocks pointer input on the same controls.
 *
 * This only keeps the UI honest. The proxy and every Server Action refuse
 * phone writes on the server (src/proxy.ts, src/lib/auth/edit-policy.ts).
 * Removing `data-view-only` from the container turns the guard off, which
 * the mobile tests use to prove the server-side refusal.
 */
const WRITE_CONTROLS = "button, input, select, textarea"

function isReadControl(el: Element): boolean {
  if (el.closest("[data-read-control]")) return true
  const form = el.closest("form")
  return !!form && form.getAttribute("method")?.toLowerCase() === "get"
}

export function ViewOnlyGuard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const apply = () => {
      if (!root.hasAttribute("data-view-only")) return
      root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(WRITE_CONTROLS).forEach((el) => {
        if (!el.disabled && !isReadControl(el)) el.disabled = true
      })
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] })
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} data-view-only="" data-testid="view-only-content">
      {children}
    </div>
  )
}
