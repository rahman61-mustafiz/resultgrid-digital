/** Client-facing pages: the backdrop is veiled so the report stays plain. */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="tech-backdrop-veil" />
      {children}
    </>
  )
}
