/**
 * The fixed "blueprint workshop" backdrop behind every page: paper gears and
 * a gear column on the right, circuit traces through the middle, faint
 * concentric arcs on the left (after the two inspiration images Rana
 * supplied on 13 October 2026). Pure SVG, decorative only: hidden from
 * assistive tech and never receives pointer input. Content stays readable
 * because pages sit on the frosted sheet/cards defined in globals.css.
 *
 * The client-facing share pages add a white veil over it
 * (src/app/share/layout.tsx), so their reports stay plain.
 */

const C = {
  paper: "#FBFCFD",
  graphite: "#1B2430",
  steel: "#566375",
  trace: "#A9B6C4",
  mint: "#8CC9BE",
  blue: "#3B82C4",
  green: "#1E9E5A",
  orange: "#E8812A",
  rust: "#8A4B2A",
}

/** A gear outline (teeth as trapezoids) with an optional centre hole, for fill-rule evenodd. */
function gear(cx: number, cy: number, r: number, teeth: number, depth: number, hole = 0): string {
  const step = (Math.PI * 2) / teeth
  const pt = (radius: number, a: number) => `${(cx + radius * Math.cos(a)).toFixed(1)} ${(cy + radius * Math.sin(a)).toFixed(1)}`
  let d = ""
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    d += `${i === 0 ? "M" : "L"}${pt(r - depth, a)} L${pt(r, a + step * 0.14)} L${pt(r, a + step * 0.4)} L${pt(r - depth, a + step * 0.54)} `
  }
  d += "Z"
  if (hole > 0) d += ` M${cx + hole} ${cy} A${hole} ${hole} 0 1 0 ${cx - hole} ${cy} A${hole} ${hole} 0 1 0 ${cx + hole} ${cy} Z`
  return d
}

/** A circuit trace: a polyline ending in a small terminal ring. */
function Trace({ points, end = true }: { points: [number, number][]; end?: boolean }) {
  const [x, y] = points[points.length - 1]
  return (
    <g>
      <polyline points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke={C.trace} strokeWidth="1.4" />
      {end ? <circle cx={x} cy={y} r="5" fill={C.paper} stroke={C.steel} strokeWidth="1.4" /> : null}
    </g>
  )
}

/** A stack of small rectangles, like the resistor/pin rows in the inspiration. */
function Pins({ x, y, n, vertical = true }: { x: number; y: number; n: number; vertical?: boolean }) {
  return (
    <g fill="none" stroke={C.steel} strokeWidth="1.1" opacity="0.7">
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={vertical ? x : x + i * 14} y={vertical ? y + i * 14 : y} width="10" height="9" rx="2" />
      ))}
    </g>
  )
}

export function TechBackdrop() {
  return (
    <div aria-hidden="true" className="tech-backdrop">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMaxYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="rg-lift" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor={C.graphite} floodOpacity="0.13" />
          </filter>
          <linearGradient id="rg-haze" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#E3EAF1" />
            <stop offset="0.55" stopColor="#F3F6F9" />
            <stop offset="1" stopColor="#FFFFFF" />
          </linearGradient>
        </defs>

        <rect width="1600" height="1000" fill="url(#rg-haze)" />

        {/* Concentric arcs, lower left */}
        <g fill="none" stroke={C.trace} opacity="0.45">
          <circle cx="-120" cy="980" r="720" strokeWidth="1.2" />
          <circle cx="-120" cy="980" r="660" strokeWidth="14" strokeDasharray="6 22" opacity="0.35" />
          <circle cx="-120" cy="980" r="600" strokeWidth="1" strokeDasharray="2 8" />
          <circle cx="-120" cy="980" r="520" strokeWidth="1.2" />
        </g>

        {/* Mint data strips behind the gear column */}
        <g fill={C.mint} opacity="0.2">
          <rect x="1395" y="0" width="34" height="1000" />
          <rect x="1440" y="40" width="10" height="920" />
          <rect x="1462" y="0" width="58" height="1000" opacity="0.6" />
          <rect x="1532" y="80" width="8" height="880" />
          <rect x="1552" y="0" width="22" height="1000" opacity="0.7" />
        </g>
        <g stroke={C.mint} strokeWidth="1" opacity="0.5">
          {Array.from({ length: 18 }, (_, i) => (
            <line key={i} x1="1400" x2={1440 + (i % 4) * 30} y1={560 + i * 22} y2={560 + i * 22} />
          ))}
        </g>

        {/* Left nodes */}
        <Trace points={[[140, 182], [620, 182], [620, 170]]} />
        <circle cx="140" cy="182" r="9" fill={C.graphite} />
        <Trace points={[[70, 360], [70, 640], [20, 700]]} end={false} />
        <circle cx="70" cy="360" r="8" fill="none" stroke={C.graphite} strokeWidth="1.6" />
        <circle cx="70" cy="360" r="3" fill={C.graphite} />
        <Trace points={[[70, 660], [180, 660]]} />
        <g fill={C.steel}>
          {[420, 446, 472, 498].map((y) => (
            <circle key={y} cx="70" cy={y} r="3.2" />
          ))}
        </g>

        {/* Circuit traces through the middle */}
        <Trace points={[[860, 0], [860, 300], [1010, 300]]} />
        <Trace points={[[900, 40], [900, 120]]} />
        <Trace points={[[960, 0], [960, 210]]} end={false} />
        <Trace points={[[760, 330], [1120, 330], [1120, 520]]} end={false} />
        <Trace points={[[780, 420], [780, 600], [690, 690], [690, 980]]} />
        <Trace points={[[830, 360], [830, 560], [900, 620], [900, 780]]} />
        <Trace points={[[980, 600], [980, 700], [1040, 760], [1040, 900]]} />
        <Trace points={[[1060, 380], [1060, 560], [1000, 600]]} end={false} />
        <Trace points={[[740, 640], [600, 640], [600, 860]]} />
        <Pins x={1015} y={60} n={4} />
        <Pins x={925} y={420} n={6} />
        <Pins x={710} y={760} n={5} />
        <Pins x={1080} y={640} n={3} vertical={false} />
        <g fill={C.graphite} opacity="0.75">
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${1010 + i * 12} 250 l5 9 l5 -9 z`} />
          ))}
        </g>
        <path d="M690 560 L800 560 L740 500 Z" fill="none" stroke={C.steel} strokeWidth="1.2" opacity="0.7" />
        <path d="M1150 820 l8 14 l8 -14 z" fill="none" stroke={C.steel} strokeWidth="1.2" />
        <circle cx="900" cy="600" r="14" fill={C.paper} stroke={C.graphite} strokeWidth="3" />
        <circle cx="900" cy="600" r="6" fill={C.graphite} />

        {/* Signal dots */}
        <circle cx="1010" cy="200" r="12" fill={C.green} />
        <circle cx="780" cy="560" r="11" fill={C.orange} />
        <circle cx="900" cy="830" r="12" fill={C.rust} />
        <path d={gear(1000, 860, 26, 12, 6, 12)} fill={C.blue} fillRule="evenodd" opacity="0.9" />
        <circle cx="1000" cy="860" r="11" fill={C.graphite} />

        {/* Gear column: paper gears with soft shadows, the big one turning */}
        <g filter="url(#rg-lift)">
          <g className="rg-spin-slow" style={{ transformOrigin: "1150px 115px" }}>
            <path d={gear(1150, 115, 125, 14, 22, 62)} fill={C.paper} fillRule="evenodd" />
          </g>
          <g className="rg-spin" style={{ transformOrigin: "1335px 300px" }}>
            <path d={gear(1335, 300, 200, 18, 28, 0)} fill={C.paper} />
            <circle cx="1335" cy="300" r="128" fill="#F1F5F8" />
            <circle cx="1335" cy="300" r="112" fill="none" stroke={C.blue} strokeWidth="10" strokeDasharray="4 7" opacity="0.55" />
            <circle cx="1335" cy="300" r="96" fill="none" stroke={C.steel} strokeWidth="1" opacity="0.6" />
            <path d={gear(1335, 300, 82, 12, 16, 46)} fill={C.paper} fillRule="evenodd" />
          </g>
          <path d={gear(1050, 560, 92, 12, 18, 52)} fill={C.paper} fillRule="evenodd" />
        </g>
        <circle cx="1050" cy="560" r="40" fill="none" stroke={C.steel} strokeWidth="1.2" opacity="0.6" />

        <path d={gear(1565, 420, 40, 10, 10, 0)} fill={C.blue} opacity="0.85" />
        <path d={gear(1490, 500, 64, 10, 16, 36)} fill={C.graphite} fillRule="evenodd" />
        <g fill="none" stroke={C.graphite} strokeWidth="2.2" opacity="0.7">
          <path d={gear(1510, 625, 56, 12, 12, 0)} />
          <circle cx="1510" cy="625" r="22" />
          <path d="M1510 603 L1510 625 L1529 636 M1510 625 L1491 636" />
        </g>
        <g fill="none" stroke={C.steel} strokeWidth="1.6" opacity="0.65">
          <path d={gear(1500, 770, 66, 16, 10, 0)} />
          <circle cx="1500" cy="770" r="44" />
        </g>
        <path d={gear(1475, 905, 44, 12, 9, 0)} fill="none" stroke={C.orange} strokeWidth="1.8" opacity="0.8" />
        <path d={gear(1420, 985, 34, 9, 9, 0)} fill={C.rust} opacity="0.85" />
      </svg>
    </div>
  )
}
