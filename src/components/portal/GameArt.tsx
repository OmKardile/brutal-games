// Per-game SVG art — server-safe, dependency-free, theme-proof (accent colors
// read well on both night and day cards). Used on the hub, category pages,
// related-games lists and the poster.

import { ACCENTS, NEUTRALS, type GameThemeMode } from '@/game/theme'
import type { GameSlug } from '@/games/types'

export function GameArt({ slug, className }: { slug: GameSlug; className?: string }) {
  const { main, dim, hot } = ACCENTS[slug].night
  return (
    <svg
      viewBox="0 0 400 225"
      className={className}
      role="img"
      aria-label={`${slug} key art`}
      preserveAspectRatio="xMidYMid slice"
    >
      {/* shared backdrop */}
      <rect width="400" height="225" fill="#0b0b10" />
      <g stroke="rgba(255,255,255,0.06)" strokeWidth="1">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 25} x2="400" y2={i * 25} />
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <line key={`v${i}`} x1={i * 25} y1="0" x2={i * 25} y2="225" />
        ))}
      </g>
      {slug === 'arena' && <ArenaArt main={main} dim={dim} hot={hot} />}
      {slug === 'stack' && <StackArt main={main} dim={dim} hot={hot} />}
      {slug === 'reflex' && <ReflexArt main={main} dim={dim} hot={hot} />}
      {slug === 'dodge' && <DodgeArt main={main} dim={dim} hot={hot} />}
      {slug === 'merge' && <MergeArt main={main} dim={dim} hot={hot} />}
      {/* scanline texture */}
      <rect width="400" height="225" fill="url(#scan)" opacity="0.5" />
      <defs>
        <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="rgba(0,0,0,0.25)" />
        </pattern>
      </defs>
    </svg>
  )
}

interface ArtColors {
  main: string
  dim: string
  hot: string
}

function ArenaArt({ main, dim, hot }: ArtColors) {
  return (
    <g>
      <circle cx="200" cy="112" r="64" fill="none" stroke={dim} strokeWidth="3" />
      <circle cx="200" cy="112" r="40" fill="none" stroke={main} strokeWidth="2" strokeDasharray="6 6" />
      <line x1="200" y1="32" x2="200" y2="192" stroke={main} strokeWidth="1.5" opacity="0.6" />
      <line x1="120" y1="112" x2="280" y2="112" stroke={main} strokeWidth="1.5" opacity="0.6" />
      <circle cx="200" cy="112" r="5" fill={hot} />
      <circle cx="112" cy="60" r="7" fill={dim} />
      <circle cx="296" cy="170" r="7" fill={dim} />
      <polygon points="112,60 126,54 126,66" fill={main} />
      <polygon points="296,170 310,164 310,176" fill={main} />
    </g>
  )
}

function StackArt({ main, dim, hot }: ArtColors) {
  // isometric blocks
  const iso = (x: number, y: number, w: number, d: number, h: number, fill: string, stroke: string) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
      <polygon points={`0,0 ${w},${d * 0.5} 0,${d} ${-w},${d * 0.5}`} fill={fill} stroke={stroke} strokeWidth="1.5" />
      <polygon points={`${-w},${d * 0.5} 0,${d} 0,${d + h} ${-w},${d * 0.5 + h}`} fill={stroke} opacity="0.6" />
      <polygon points={`${w},${d * 0.5} 0,${d} 0,${d + h} ${w},${d * 0.5 + h}`} fill={stroke} opacity="0.8" />
    </g>
  )
  return (
    <g>
      {iso(140, 80, 60, 44, 30, main, dim)}
      {iso(160, 108, 52, 40, 26, hot, main)}
      {iso(178, 132, 44, 34, 22, main, dim)}
      {iso(192, 154, 38, 30, 18, hot, main)}
      <rect x="120" y="180" width="160" height="3" fill={dim} />
    </g>
  )
}

function ReflexArt({ main, dim, hot }: ArtColors) {
  return (
    <g>
      {/* track */}
      <rect x="70" y="150" width="260" height="6" fill={dim} />
      {/* strike zone */}
      <rect x="168" y="132" width="64" height="42" fill={main} opacity="0.35" stroke={main} strokeWidth="2" />
      {/* sweeping blade */}
      <polygon points="150,66 168,140 132,140" fill={hot} />
      <line x1="150" y1="60" x2="150" y2="150" stroke={hot} strokeWidth="1.5" opacity="0.5" />
      {/* chime ladder */}
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={86 + i * 16} y={118 - i * 12} width="8" height={12 + i * 12} fill={i >= 2 ? main : dim} opacity={i >= 2 ? 0.9 : 0.5} />
      ))}
    </g>
  )
}

function DodgeArt({ main, dim, hot }: ArtColors) {
  // vertical gauntlet: gates + zigzag flight path
  return (
    <g>
      <rect x="120" y="20" width="70" height="14" fill={dim} />
      <rect x="210" y="56" width="70" height="14" fill={dim} />
      <rect x="120" y="92" width="70" height="14" fill={dim} />
      <rect x="210" y="128" width="70" height="14" fill={dim} />
      <rect x="120" y="164" width="70" height="14" fill={dim} />
      <path
        d="M150 30 C 240 40, 150 80, 245 100 C 160 120, 235 150, 150 172"
        fill="none"
        stroke={main}
        strokeWidth="3"
        strokeDasharray="7 5"
      />
      <circle cx="150" cy="172" r="7" fill={hot} />
      <circle cx="300" cy="70" r="5" fill={main} opacity="0.7" />
      <circle cx="86" cy="150" r="5" fill={main} opacity="0.7" />
    </g>
  )
}

function MergeArt({ main, dim, hot }: ArtColors) {
  return (
    <g>
      {/* pit walls */}
      <path d="M110 30 L110 195 L290 195 L290 30" fill="none" stroke={dim} strokeWidth="3" />
      {/* danger line */}
      <line x1="110" y1="58" x2="290" y2="58" stroke={hot} strokeWidth="2" strokeDasharray="6 5" />
      {/* fusion chain */}
      <circle cx="252" cy="168" r="16" fill={dim} />
      <circle cx="212" cy="164" r="22" fill={main} opacity="0.55" />
      <circle cx="164" cy="150" r="30" fill={main} opacity="0.75" />
      <circle cx="182" cy="98" r="40" fill={main} />
      <circle cx="182" cy="98" r="40" fill="none" stroke={hot} strokeWidth="2" />
      {/* incoming droplet */}
      <circle cx="262" cy="16" r="9" fill={hot} />
      <line x1="262" y1="26" x2="262" y2="40" stroke={hot} strokeWidth="1.5" strokeDasharray="3 3" />
    </g>
  )
}

/** accent swatch helper for cards (label chips etc.) */
export function accentFor(slug: GameSlug, mode: GameThemeMode = 'night') {
  return ACCENTS[slug][mode]
}

export const ART_NEUTRALS = NEUTRALS
