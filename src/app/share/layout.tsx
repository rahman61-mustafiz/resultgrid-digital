/** Client-facing pages: no sky band, so the report stays plain. */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <div className="rg-plain contents">{children}</div>
}
