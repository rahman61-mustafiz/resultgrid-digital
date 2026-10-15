/**
 * The light sky band behind the top of every page: a soft gradient, a
 * rounded blob on the left edge and a white wave into the page below (after
 * the Noor admin reference Rana supplied on 14 October 2026). Decorative
 * only: hidden from assistive tech, never receives pointer input, and
 * scrolls away with the page. Client share pages hide it (.rg-plain).
 */
export function SkyBackdrop() {
  return (
    <div aria-hidden="true" className="rg-sky">
      <svg viewBox="0 0 1600 440" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="rg-sky-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sky-top)" />
            <stop offset="1" stopColor="var(--sky-bottom)" />
          </linearGradient>
        </defs>
        <rect width="1600" height="440" fill="url(#rg-sky-fill)" />
        <path d="M0 330 C 260 400, 560 300, 860 318 S 1380 392, 1600 350 L1600 440 L0 440 Z" fill="var(--background)" opacity="0.55" />
        <path d="M0 362 C 300 410, 620 322, 920 336 S 1400 412, 1600 380 L1600 440 L0 440 Z" fill="var(--background)" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: "-120px",
          top: "170px",
          width: "260px",
          height: "260px",
          borderRadius: "9999px",
          background: "var(--sky-blob)",
          opacity: 0.55,
        }}
      />
    </div>
  )
}
