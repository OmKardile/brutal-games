'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ACHIEVEMENTS,
  fmtDuration,
  levelFromXp,
  loadPilot,
  type PilotData,
} from '@/game/pilot'
import { useTheme } from '@/lib/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { apiUrl, fetchBoard, type BoardEntry, type BoardTotals, type GameId } from '@/lib/scores-client'
import { assetUrl } from '@/lib/assets'
import { cn } from '@/lib/utils'
import {
  Activity,
  Atom,
  ChevronRight,
  Clock,
  Flame,
  Gamepad2,
  Globe,
  Keyboard,
  Layers,
  MousePointerClick,
  Play,
  Skull,
  Swords,
  Target,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react'

// ============================================================ game catalog

interface GameMeta {
  id: GameId
  href: string
  name: string
  tag: string
  accent: string // picked per theme below via accentFor()
  night: string
  day: string
  desc: string
  meta: string[]
  span: string
  boardCols: [string, string] // [wave col label, kills col label]
  fmtWave: (w: number) => string
  fmtKills: (k: number) => string
}

const GAMES: GameMeta[] = [
  {
    id: 'arena',
    href: '/play',
    name: 'ARENA',
    tag: 'TWIN-STICK SHOOTER',
    accent: '#ff2d2d',
    night: '#ff2d2d',
    day: '#dc2626',
    desc: 'Top-down wave survival. Draft upgrades between waves, chain killstreaks, charge OVERDRIVE and kill the Brute every 5th wave.',
    meta: ['WASD + MOUSE', 'TOUCH', 'GAMEPAD', '~3 MIN RUNS'],
    span: 'md:col-span-4',
    boardCols: ['WAVE', 'KILLS'],
    fmtWave: (w) => `W${w}`,
    fmtKills: (k) => `${k} K`,
  },
  {
    id: 'stack',
    href: '/stack',
    name: 'STACK',
    tag: 'ONE-TAP TOWER',
    accent: '#ffb020',
    night: '#ffb020',
    day: '#b45309',
    desc: 'One tap. Drop the block, slice the overhang, chain PERFECT drops to regrow the tower. How high before it collapses?',
    meta: ['SINGLE TAP', '30-SECOND RUNS', 'INSTANT RETRY'],
    span: 'md:col-span-2',
    boardCols: ['ALT', 'PERFECT'],
    fmtWave: (w) => `${w} ALT`,
    fmtKills: (k) => `${k} P`,
  },
  {
    id: 'reflex',
    href: '/reflex',
    name: 'REFLEX',
    tag: 'TIMING STRIKE',
    accent: '#22d3ee',
    night: '#22d3ee',
    day: '#0891b2',
    desc: 'A blade sweeps. Tap inside the zone. Perfect hits regrow it, sloppy hits shrink it, one miss ends everything.',
    meta: ['ONE INPUT', 'STREAK LADDER', 'SLOW-MO DEATH'],
    span: 'md:col-span-2',
    boardCols: ['STREAK', 'PERFECT'],
    fmtWave: (w) => `×${w}`,
    fmtKills: (k) => `${k} P`,
  },
  {
    id: 'dodge',
    href: '/dodge',
    name: 'DODGE',
    tag: 'ONE-BUTTON GAUNTLET',
    accent: '#c084fc',
    night: '#c084fc',
    day: '#7c3aed',
    desc: 'Hold to climb, release to fall. Graze obstacles for CLOSE bonuses, snatch orbs from stupid places, never touch red.',
    meta: ['HOLD ANYTHING', 'NEAR-MISS BONUSES', 'SPEED RAMP'],
    span: 'md:col-span-2',
    boardCols: ['METERS', 'ORBS'],
    fmtWave: (w) => `${w}m`,
    fmtKills: (k) => `${k} ORB`,
  },
  {
    id: 'merge',
    href: '/merge',
    name: 'MERGE',
    tag: 'DROP-FUSE PIT',
    accent: '#a3e635',
    night: '#a3e635',
    day: '#4d7c0f',
    desc: 'Drop orbs, fuse matching tiers, chain combos up to ×6. Forge the tier-11 SINGULARITY and watch it eat the pit.',
    meta: ['AIM + DROP', 'CHAIN ×6', 'SINGULARITY'],
    span: 'md:col-span-2',
    boardCols: ['FORGE', 'FUSIONS'],
    fmtWave: (w) => `T${w}`,
    fmtKills: (k) => `${k} FUSE`,
  },
]

function accentFor(g: GameMeta, theme: 'night' | 'day'): string {
  return theme === 'night' ? g.night : g.day
}

// ============================================================ game art (SVG)

function StackArt() {
  return (
    <svg viewBox="0 0 200 230" className="h-44 w-full" aria-hidden>
      <polygon points="152,150 100,176 100,216 152,190" fill="#b91c1c" />
      <polygon points="48,150 100,176 100,216 48,190" fill="#7f1d1d" />
      <polygon points="100,124 152,150 100,176 48,150" fill="#ef4444" />
      <polygon points="144,110 100,132 100,166 144,144" fill="#b45309" />
      <polygon points="56,110 100,132 100,166 56,144" fill="#92400e" />
      <polygon points="100,88 144,110 100,132 56,110" fill="#f59e0b" />
      <polygon
        points="100,88 144,110 100,132 56,110"
        fill="none"
        stroke="#fde68a"
        strokeWidth="2"
        opacity="0.9"
      />
      <polygon points="160,72 124,90 124,118 160,100" fill="#b91c1c" />
      <polygon points="88,72 124,90 124,118 88,100" fill="#991b1b" />
      <polygon points="124,54 160,72 124,90 88,72" fill="#f87171" />
      <rect x="150" y="46" width="4" height="4" fill="#fde68a" />
      <rect x="171" y="60" width="3" height="3" fill="#fbbf24" />
      <rect x="140" y="32" width="3" height="3" fill="#fbbf24" />
      <rect x="163" y="24" width="4" height="4" fill="#fde68a" />
    </svg>
  )
}

function ReflexArt() {
  return (
    <svg viewBox="0 0 200 230" className="h-44 w-full" aria-hidden>
      {/* track */}
      <rect x="14" y="118" width="172" height="34" rx="2" fill="#12121a" stroke="#22d3ee" strokeOpacity="0.3" />
      {/* ticks */}
      {[...Array(9)].map((_, i) => (
        <rect key={i} x={22 + i * 20} y={140} width="2" height="12" fill="#22d3ee" opacity="0.25" />
      ))}
      {/* zone */}
      <rect x="96" y="121" width="44" height="28" fill="#22d3ee" opacity="0.3" />
      <rect x="96" y="112" width="3" height="46" fill="#22d3ee" />
      <rect x="137" y="112" width="3" height="46" fill="#22d3ee" />
      <rect x="117" y="106" width="2" height="58" fill="#ffffff" />
      {/* blade */}
      <rect x="58" y="104" width="6" height="62" fill="#22d3ee" />
      <rect x="60" y="100" width="2" height="70" fill="#ffffff" />
      {/* trail */}
      <rect x="40" y="112" width="4" height="46" fill="#22d3ee" opacity="0.25" />
      <rect x="30" y="112" width="3" height="46" fill="#22d3ee" opacity="0.12" />
      {/* score pop */}
      <text x="118" y="86" fontFamily="monospace" fontSize="13" fontWeight="900" fill="#a5f3fc">
        PERFECT
      </text>
      {/* sparks */}
      <rect x="150" y="66" width="4" height="4" fill="#a5f3fc" />
      <rect x="166" y="82" width="3" height="3" fill="#22d3ee" />
      <rect x="138" y="52" width="3" height="3" fill="#67e8f9" />
      <circle cx="60" cy="92" r="10" fill="none" stroke="#22d3ee" strokeWidth="2" opacity="0.7" />
    </svg>
  )
}

function DodgeArt() {
  return (
    <svg viewBox="0 0 200 230" className="h-44 w-full" aria-hidden>
      {/* walls */}
      <rect x="0" y="8" width="200" height="6" fill="#dc2626" />
      <rect x="0" y="216" width="200" height="6" fill="#dc2626" />
      {/* gate */}
      <rect x="128" y="14" width="18" height="72" fill="#12121a" stroke="#c084fc" strokeOpacity="0.4" />
      <rect x="128" y="144" width="18" height="72" fill="#12121a" stroke="#c084fc" strokeOpacity="0.4" />
      <rect x="128" y="84" width="18" height="3" fill="#c084fc" />
      <rect x="128" y="141" width="18" height="3" fill="#c084fc" />
      {/* orb */}
      <circle cx="160" cy="112" r="7" fill="#6dff8a" />
      <circle cx="157" cy="109" r="2" fill="#ffffff" />
      {/* ship */}
      <polygon points="86,115 60,101 67,115 60,129" fill="#f5f5f4" />
      <circle cx="78" cy="113" r="4" fill="#c084fc" />
      <polygon points="62,108 44,115 62,122" fill="#ffb020" opacity="0.85" />
      {/* near-miss pop */}
      <text x="84" y="88" fontFamily="monospace" fontSize="11" fontWeight="900" fill="#e9d5ff">
        CLOSE +25
      </text>
      {/* speed lines */}
      <line x1="0" y1="60" x2="28" y2="60" stroke="#a8a29e" strokeWidth="1" opacity="0.4" />
      <line x1="0" y1="168" x2="18" y2="168" stroke="#a8a29e" strokeWidth="1" opacity="0.4" />
      <line x1="14" y1="190" x2="40" y2="190" stroke="#a8a29e" strokeWidth="1" opacity="0.3" />
    </svg>
  )
}

function MergeArt() {
  const tiers = [
    { cx: 100, cy: 196, r: 26, c: '#8b1f1f' },
    { cx: 64, cy: 196, r: 26, c: '#8b1f1f' },
    { cx: 138, cy: 196, r: 26, c: '#b91c1c' },
    { cx: 100, cy: 160, r: 30, c: '#ea580c' },
    { cx: 62, cy: 158, r: 24, c: '#dc2626' },
    { cx: 100, cy: 118, r: 26, c: '#f59e0b' },
    { cx: 140, cy: 150, r: 22, c: '#f97316' },
  ]
  return (
    <svg viewBox="0 0 200 230" className="h-44 w-full" aria-hidden>
      {/* pit */}
      <line x1="26" y1="20" x2="26" y2="222" stroke="#57534e" strokeWidth="4" />
      <line x1="174" y1="20" x2="174" y2="222" stroke="#57534e" strokeWidth="4" />
      <line x1="26" y1="222" x2="174" y2="222" stroke="#57534e" strokeWidth="4" />
      {/* danger line */}
      <line x1="26" y1="64" x2="174" y2="64" stroke="#dc2626" strokeWidth="2" strokeDasharray="8 6" opacity="0.7" />
      {/* dropper orb */}
      <circle cx="100" cy="40" r="16" fill="#b91c1c" stroke="#7f1d1d" strokeWidth="3" />
      <ellipse cx="94" cy="34" rx="4" ry="2.5" fill="#ffffff" opacity="0.5" />
      {/* orbs */}
      {tiers.map((t, i) => (
        <g key={i}>
          <circle cx={t.cx} cy={t.cy} r={t.r} fill={t.c} stroke="#00000055" strokeWidth="2" />
          <ellipse cx={t.cx - t.r * 0.3} cy={t.cy - t.r * 0.4} rx={t.r * 0.2} ry={t.r * 0.12} fill="#ffffff" opacity="0.45" />
        </g>
      ))}
      {/* fuse flash */}
      <circle cx="100" cy="118" r="34" fill="none" stroke="#fde047" strokeWidth="2" opacity="0.8" />
      <text x="100" y="102" fontFamily="monospace" fontSize="11" fontWeight="900" fill="#d9f99d" textAnchor="middle">
        +30 ×3
      </text>
    </svg>
  )
}

const GAME_ART: Record<GameId, () => React.ReactElement> = {
  arena: () => <div aria-hidden className="h-44 w-full" />,
  stack: StackArt,
  reflex: ReflexArt,
  dodge: DodgeArt,
  merge: MergeArt,
}

// ================================================================ bestiary

const BESTIARY = [
  { name: 'GRUNT', color: '#ff4444', shape: 'square', threat: 1, desc: 'Slow, relentless, everywhere. The bread and butter of the horde.' },
  { name: 'DARTER', color: '#ff9f1a', shape: 'dart', threat: 2, desc: 'Weaves in fast at 210 units/s. Punishes standing still.' },
  { name: 'SPLITTER', color: '#b8e62e', shape: 'orb', threat: 2, desc: 'Pops into two furious minis when it dies. Kill it mid-dash.' },
  { name: 'SPITTER', color: '#ff5c8a', shape: 'pentagon', threat: 3, desc: 'Keeps distance and fires 3-round bursts. Flank it, don\u2019t chase it.' },
  { name: 'TANK', color: '#b91c1c', shape: 'hex', threat: 4, desc: '250 HP of armored hatred. Barely flinches at knockback.' },
  { name: 'THE BRUTE', color: '#ff2222', shape: 'spike', threat: 5, desc: 'Every 5th wave. Radial bullet storms, spawns minions, enrages at 30%. Pray.' },
]

function EnemyGlyph({ shape, color }: { shape: string; color: string }) {
  const common = { fill: color, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.5 }
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden>
      {shape === 'square' && <rect x="14" y="14" width="36" height="36" rx="3" transform="rotate(45 32 32)" {...common} />}
      {shape === 'dart' && <polygon points="56,32 12,50 24,32 12,14" {...common} />}
      {shape === 'orb' && (
        <>
          <circle cx="32" cy="32" r="19" {...common} />
          <circle cx="32" cy="32" r="9" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="3" />
        </>
      )}
      {shape === 'pentagon' && <polygon points="32,10 54,26 46,52 18,52 10,26" {...common} />}
      {shape === 'hex' && (
        <>
          <polygon points="32,8 54,20 54,44 32,56 10,44 10,20" {...common} />
          <polygon points="32,20 44,26 44,38 32,44 20,38 20,26" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="3" />
        </>
      )}
      {shape === 'spike' && (
        <>
          <polygon
            points="32,2 38,14 50,8 48,21 62,22 54,32 62,42 48,43 50,56 38,50 32,62 26,50 14,56 16,43 2,42 10,32 2,22 16,21 14,8 26,14"
            {...common}
          />
          <circle cx="32" cy="32" r="9" fill="#1a0505" />
          <circle cx="32" cy="32" r="4.5" fill="#ff6b35" />
        </>
      )}
    </svg>
  )
}

// ============================================================ reveal + misc

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      data-visible={visible}
      className={cn('brutal-reveal', className)}
      style={{ ['--reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

function useInView() {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, inView }
}

function CountUp({ target, active, suffix = '' }: { target: number; active: boolean; suffix?: string }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const t0 = performance.now()
    const dur = 1400
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setV(Math.round(target * e))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active])
  return (
    <span className="tabular-nums">
      {v.toLocaleString()}
      {suffix}
    </span>
  )
}

function Marquee({ items, reverse = false, duration = 24 }: { items: string[]; reverse?: boolean; duration?: number }) {
  const row = [...items, ...items, ...items, ...items]
  return (
    <div className="overflow-hidden" aria-hidden>
      <div
        className={cn('brutal-marquee', reverse && 'brutal-marquee-reverse')}
        style={{ ['--marquee-dur' as string]: `${duration}s` }}
      >
        {[0, 1].map((half) => (
          <div key={half} className="flex shrink-0 items-center">
            {row.map((label, i) => (
              <span key={`${half}-${i}`} className="flex items-center whitespace-nowrap">
                <span className="px-5">{label}</span>
                <span className="text-[0.6em] opacity-60">✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ================================================================ the page

export default function LandingPage() {
  const { theme } = useTheme()

  const [pilot, setPilot] = useState<PilotData | null>(null)
  const [rewardsEnabled, setRewardsEnabled] = useState(false)
  const [totals, setTotals] = useState<{ runs: number; kills: number; top: number } | null>(null)

  // leaderboard tabs
  const [activeGame, setActiveGame] = useState<GameId>('arena')
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [boardMode, setBoardMode] = useState<'online' | 'local'>('online')
  const [boardLoading, setBoardLoading] = useState(true)

  // hero parallax layers (direct DOM writes — no re-render storm)
  const heroLayerA = useRef<HTMLDivElement>(null)
  const heroLayerB = useRef<HTMLDivElement>(null)
  const onHeroMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width - 0.5
    const ny = (e.clientY - r.top) / r.height - 0.5
    if (heroLayerA.current) {
      heroLayerA.current.style.transform = `translate(${nx * 16}px, ${ny * 12}px)`
    }
    if (heroLayerB.current) {
      heroLayerB.current.style.transform = `translate(${nx * -26}px, ${ny * -18}px)`
    }
  }, [])

  useEffect(() => {
    setPilot(loadPilot())
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/rewards/config'), { cache: 'no-store' })
        if (res.ok) {
          const cfg = (await res.json()) as { enabled?: boolean }
          setRewardsEnabled(Boolean(cfg.enabled))
        }
      } catch {
        // rewards nav stays hidden on failure
      }
    })()
    void (async () => {
      // stats band — totals across every game
      try {
        const results = await Promise.all(GAMES.map((g) => fetchBoard(g.id)))
        const runs = results.reduce((s, r) => s + (r.totals?.runs ?? 0), 0)
        const kills = results.reduce((s, r) => s + (r.totals?.kills ?? 0), 0)
        const top = results.reduce((m, r) => Math.max(m, r.totals?.top ?? 0), 0)
        setTotals({ runs, kills, top })
      } catch {
        setTotals({ runs: 0, kills: 0, top: 0 })
      }
    })()
  }, [])

  const loadBoard = useCallback(async (game: GameId) => {
    setBoardLoading(true)
    try {
      const res = await fetchBoard(game)
      setBoard(res.scores)
      setBoardMode(res.mode)
    } catch {
      setBoard([])
    } finally {
      setBoardLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBoard(activeGame)
  }, [activeGame, loadBoard])

  const lvl = pilot ? levelFromXp(pilot.xp) : null
  const returning = !!pilot && pilot.runs > 0
  const activeMeta = GAMES.find((g) => g.id === activeGame) ?? GAMES[0]
  const statsRef = useInView()

  const navLinks: { label: string; href: string }[] = [
    { label: 'GAMES', href: '#games' },
    { label: 'BESTIARY', href: '#bestiary' },
    { label: 'HOW TO', href: '#howto' },
    { label: 'LEADERBOARD', href: '#leaderboard' },
  ]

  return (
    <main className="min-h-dvh w-full overflow-x-clip bg-[var(--bg)] font-mono text-[var(--ink)]">
      {/* ============================================================ NAV */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-[var(--line)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--accent)] text-xs font-black text-white transition-transform group-hover:rotate-6">
              B//
            </span>
            <span className="text-sm font-black tracking-[0.25em] text-[var(--ink)]">
              BRUTAL<span className="text-[var(--accent)]">//</span>GAMES
            </span>
          </Link>
          <div className="hidden items-center gap-7 text-[11px] tracking-[0.25em] text-[var(--ink-dim)] lg:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="transition-colors hover:text-[var(--accent)]">
                {l.label}
              </a>
            ))}
            {rewardsEnabled && (
              <Link href="/rewards" className="text-amber-500 transition-colors hover:text-amber-400">
                REWARDS
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/play" className="hidden sm:block">
              <Button className="h-9 border border-[var(--accent)] bg-[var(--accent)] px-5 text-xs font-black tracking-[0.2em] text-white hover:brightness-110">
                <Play className="mr-1.5 h-3.5 w-3.5" /> PLAY NOW
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ============================================================ HERO */}
      <section className="relative flex min-h-dvh flex-col justify-center overflow-hidden pt-16">
        {/* color field */}
        <div className="absolute inset-0" aria-hidden>
          <div
            className="brutal-blob absolute -left-32 top-10 h-[46vw] w-[46vw] rounded-full opacity-[0.16] blur-[110px]"
            style={{ background: '#ff2d2d' }}
          />
          <div
            className="brutal-blob absolute -right-24 top-1/3 h-[38vw] w-[38vw] rounded-full opacity-[0.13] blur-[110px]"
            style={{ background: '#7c3aed', animationDelay: '-5s' }}
          />
          <div
            className="brutal-blob absolute bottom-0 left-1/3 h-[30vw] w-[30vw] rounded-full opacity-[0.1] blur-[100px]"
            style={{ background: '#22d3ee', animationDelay: '-9s' }}
          />
          <div
            className="brutal-blob absolute bottom-1/4 right-1/3 h-[22vw] w-[22vw] rounded-full opacity-[0.08] blur-[90px]"
            style={{ background: '#a3e635', animationDelay: '-3s' }}
          />
        </div>
        <div className="brutal-grain absolute inset-0 opacity-60" aria-hidden />
        <div className="brutal-scanline" aria-hidden />

        {/* corner labels */}
        <div className="absolute left-4 top-20 hidden text-[9px] tracking-[0.4em] text-[var(--ink-faint)] md:block" aria-hidden>
          EST. 2025 — BROWSER FIRST
        </div>
        <div className="absolute right-4 top-20 hidden text-[9px] tracking-[0.4em] text-[var(--ink-faint)] md:block" aria-hidden>
          5 GAMES / 0 DOWNLOADS / ∞ RETRIES
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 py-16 md:px-6" onMouseMove={onHeroMove}>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--panel)] px-4 py-1.5 text-[10px] tracking-[0.35em] text-[var(--ink-dim)] backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
            </span>
            FREE BROWSER ARCADE — NOTHING TO INSTALL
          </div>

          {/* MEGA TYPE — layered RGB split + parallax */}
          <h1 className="font-display select-none leading-[0.82]">
            <span className="block text-[19vw] tracking-tight text-[var(--ink)] md:text-[11rem]">
              BRUTAL
            </span>
            <span
              ref={heroLayerA}
              className="relative block text-[13vw] tracking-tight md:text-[7.5rem]"
            >
              <span aria-hidden className="absolute -left-1 top-1 text-[#ff2d2d] opacity-70 blur-[3px]">
                //GAMES
              </span>
              <span aria-hidden className="absolute -right-1 top-[-4px] text-[#22d3ee] opacity-60 blur-[3px]">
                //GAMES
              </span>
              <span className="brutal-outline relative">//GAMES</span>
            </span>
          </h1>

          <div ref={heroLayerB} className="mt-8 max-w-xl transition-transform duration-200">
            <p className="text-sm leading-relaxed text-[var(--ink-dim)] md:text-base">
              Five loud little arcade games. Kill the horde, stack the tower, hit
              the zone, thread the gauntlet, fuse the pit.{' '}
              <span className="text-[var(--ink)]">One run is 3 minutes.</span>{' '}
              &ldquo;One more run&rdquo; is 2 hours.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/play" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="brutal-glow h-14 w-full border border-[var(--accent)] bg-[var(--accent)] px-10 text-base font-black tracking-[0.2em] text-white hover:brightness-110 sm:w-auto"
                >
                  <Play className="mr-2 h-5 w-5" /> START WITH ARENA
                </Button>
              </Link>
              <a href="#games" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 w-full border-[var(--line-strong)] bg-[var(--panel)] px-8 text-sm font-black tracking-[0.2em] text-[var(--ink)] backdrop-blur hover:border-[var(--ink)] sm:w-auto"
                >
                  ALL 5 GAMES <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </a>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] tracking-[0.25em] text-[var(--ink-faint)]">
              <span className="flex items-center gap-1.5">
                <Keyboard className="h-3.5 w-3.5 text-[var(--accent)]" /> KEYBOARD
              </span>
              <span className="flex items-center gap-1.5">
                <MousePointerClick className="h-3.5 w-3.5 text-[var(--accent)]" /> MOUSE + TOUCH
              </span>
              <span className="flex items-center gap-1.5">
                <Gamepad2 className="h-3.5 w-3.5 text-[var(--accent)]" /> GAMEPAD
              </span>
              <span className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-[var(--accent)]" /> GLOBAL SCORES
              </span>
            </div>
          </div>
        </div>

        {/* hero marquee ribbon */}
        <div className="absolute inset-x-0 bottom-0 border-t border-[var(--line)] bg-[var(--bg)]/70 py-3 backdrop-blur">
          <Marquee
            items={['ARENA', 'STACK', 'REFLEX', 'DODGE', 'MERGE', 'PLAY FREE', 'DIE LOUD']}
            duration={26}
          />
        </div>
      </section>

      {/* ==================================================== MARQUEE BAND */}
      <section className="relative -rotate-1 border-y-4 border-[var(--bg)] bg-[var(--accent)] py-2.5 text-[var(--bg)]" aria-hidden>
        <Marquee
          items={['FIVE WAYS TO BLEED', 'PICK YOUR POISON', 'INSTANT RETRY', 'NO MERCY']}
          duration={20}
        />
      </section>

      {/* ========================================================== GAMES */}
      <section id="games" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[10px] tracking-[0.4em] text-[var(--accent)]">01 / THE LINEUP</div>
                <h2 className="font-display mt-2 text-5xl tracking-tight text-[var(--ink)] md:text-7xl">
                  PICK YOUR <span className="brutal-outline-accent">POISON</span>
                </h2>
              </div>
              <p className="max-w-xs text-right text-[11px] leading-relaxed text-[var(--ink-faint)]">
                Same pit, five disciplines. Every game runs in this tab, on any
                screen, with any input you own.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-6">
            {GAMES.map((g, i) => {
              const accent = accentFor(g, theme)
              const Art = GAME_ART[g.id]
              return (
                <Reveal key={g.id} delay={i * 70} className={cn('contents')}>
                  <Link
                    href={g.href}
                    className="group relative overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-soft)] transition-all duration-300 hover:-translate-y-1.5 hover:border-[color:var(--g)]"
                    style={{ ['--g' as string]: accent }}
                  >
                    {/* ghost index */}
                    <span
                      aria-hidden
                      className="font-display pointer-events-none absolute -right-2 -top-6 z-10 text-8xl opacity-[0.07] transition-opacity group-hover:opacity-[0.16]"
                      style={{ color: accent }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    <div className="relative h-44 overflow-hidden border-b border-[var(--line)] bg-[radial-gradient(ellipse_at_50%_30%,color-mix(in_srgb,var(--g)_14%,transparent),transparent_72%)]">
                      {g.id === 'arena' ? (
                        <Image
                          src={assetUrl('/images/shots/shot-game.jpg')}
                          alt="BRUTAL ARENA — top-down wave shooter gameplay"
                          fill
                          className="object-cover opacity-75 transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.06]">
                          <Art />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-soft)] via-transparent to-transparent" />
                      <span
                        className="absolute left-3 top-3 rounded border bg-[var(--bg)]/80 px-2 py-0.5 text-[9px] font-bold tracking-[0.25em] backdrop-blur"
                        style={{ borderColor: `${accent}88`, color: accent }}
                      >
                        {g.tag}
                      </span>
                    </div>

                    <div className="p-5">
                      <h3 className="font-display text-2xl tracking-tight text-[var(--ink)]">
                        BRUTAL <span style={{ color: accent }}>//</span> {g.name}
                      </h3>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--ink-dim)]">{g.desc}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tracking-[0.2em] text-[var(--ink-faint)]">
                        {g.meta.map((m) => (
                          <span key={m} className="flex items-center gap-3">
                            <span className="transition-colors group-hover:text-[var(--ink-dim)]">{m}</span>
                            <span className="opacity-40">·</span>
                          </span>
                        ))}
                        <span
                          className="ml-auto flex items-center gap-1 font-black transition-all group-hover:gap-2"
                          style={{ color: accent }}
                        >
                          PLAY <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ========================================================== STATS */}
      <section ref={statsRef.ref} className="border-y border-[var(--line)] bg-[var(--bg-soft)] py-14">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 md:grid-cols-4 md:px-6">
          {[
            { label: 'RUNS LOGGED', value: totals?.runs ?? 0, icon: Activity },
            { label: 'THINGS KILLED', value: totals?.kills ?? 0, icon: Skull },
            { label: 'GAMES IN THE PIT', value: 5, icon: Swords },
            { label: 'WORLD RECORD', value: totals?.top ?? 0, icon: Trophy },
          ].map((s, i) => (
            <div key={s.label} className={cn(i > 0 && 'md:border-l md:border-[var(--line)] md:pl-8')}>
              <s.icon className="h-5 w-5 text-[var(--accent)]" />
              <div className="font-display mt-3 text-4xl tracking-tight text-[var(--ink)] md:text-5xl">
                <CountUp target={s.value} active={statsRef.inView} />
              </div>
              <div className="mt-1 text-[10px] tracking-[0.3em] text-[var(--ink-faint)]">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ======================================================= BESTIARY */}
      <section id="bestiary" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <Reveal>
            <div className="text-[10px] tracking-[0.4em] text-[var(--accent)]">02 / KNOW YOUR ENEMY</div>
            <h2 className="font-display mt-2 text-5xl tracking-tight text-[var(--ink)] md:text-7xl">
              THE BESTIARY
            </h2>
            <p className="mt-3 max-w-md text-xs leading-relaxed text-[var(--ink-faint)]">
              Arena regulars. Learn what each one wants — usually you, in small
              pieces.
            </p>
          </Reveal>

          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {BESTIARY.map((b, i) => (
              <Reveal key={b.name} delay={i * 60}>
                <div className="group h-full rounded border border-[var(--line)] bg-[var(--bg-soft)] p-4 transition-all hover:-translate-y-1 hover:border-[var(--line-strong)]">
                  <div className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                    <EnemyGlyph shape={b.shape} color={b.color} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs font-black tracking-widest text-[var(--ink)]">{b.name}</span>
                    <span className="flex gap-0.5" aria-label={`threat ${b.threat} of 5`}>
                      {[...Array(5)].map((_, d) => (
                        <span
                          key={d}
                          className={cn('h-1.5 w-1.5 rounded-full', d < b.threat ? 'bg-[var(--accent)]' : 'bg-[var(--line)]')}
                        />
                      ))}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-[var(--ink-faint)]">{b.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ========================================================= HOW TO */}
      <section id="howto" className="scroll-mt-20 border-y border-[var(--line)] bg-[var(--bg-soft)] py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <Reveal>
            <div className="text-[10px] tracking-[0.4em] text-[var(--accent)]">03 / THE RULES ARE SIMPLE</div>
            <h2 className="font-display mt-2 text-5xl tracking-tight text-[var(--ink)] md:text-7xl">
              60-SECOND BRIEFING
            </h2>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                n: '01',
                t: 'PICK A WEAPON',
                d: 'Arena for gunplay, Stack for calm hands, Reflex for pure timing, Dodge for one-button chaos, Merge for the thinker\u2019s pit.',
                icon: Swords,
              },
              {
                n: '02',
                t: 'LEARN ONE VERB',
                d: 'Every game runs on one or two inputs: move, tap, hold. WASD + mouse in the Arena, everything else is a single button.',
                icon: MousePointerClick,
              },
              {
                n: '03',
                t: 'DIE. REPEAT. ASCEND.',
                d: 'Death is a 0.4-second loading screen. Retry instantly, climb the global boards, stack killstreaks and XP as you go.',
                icon: Flame,
              },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <div className="relative h-full overflow-hidden rounded border border-[var(--line)] bg-[var(--bg)] p-6">
                  <span aria-hidden className="font-display absolute -right-3 -top-7 text-9xl text-[var(--ink)] opacity-[0.05]">
                    {s.n}
                  </span>
                  <s.icon className="h-6 w-6 text-[var(--accent)]" />
                  <h3 className="font-display mt-4 text-2xl tracking-tight text-[var(--ink)]">{s.t}</h3>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--ink-dim)]">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* per-game one-liners */}
          <Reveal delay={120}>
            <div className="mt-8 grid gap-2 md:grid-cols-5">
              {GAMES.map((g) => (
                <Link
                  key={g.id}
                  href={g.href}
                  className="group flex items-center justify-between rounded border border-[var(--line)] bg-[var(--bg)] px-3.5 py-3 text-[10px] tracking-[0.2em] transition-all hover:border-[color:var(--g)]"
                  style={{ ['--g' as string]: accentFor(g, theme) }}
                >
                  <span className="font-black" style={{ color: accentFor(g, theme) }}>
                    {g.name}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--ink-faint)] transition-all group-hover:translate-x-1" />
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ==================================================== LEADERBOARD */}
      <section id="leaderboard" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[10px] tracking-[0.4em] text-[var(--accent)]">04 / HALL OF PAIN</div>
                <h2 className="font-display mt-2 text-5xl tracking-tight text-[var(--ink)] md:text-7xl">
                  LEADERBOARDS
                </h2>
              </div>
              {boardMode === 'local' && (
                <span className="rounded border border-[var(--line-strong)] px-2.5 py-1 text-[9px] tracking-[0.25em] text-[var(--ink-faint)]">
                  LOCAL BOARD — SERVER OFFLINE
                </span>
              )}
            </div>
          </Reveal>

          {/* tabs */}
          <Reveal>
            <div className="mt-8 flex flex-wrap gap-2">
              {GAMES.map((g) => {
                const active = g.id === activeGame
                const accent = accentFor(g, theme)
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveGame(g.id)}
                    className={cn(
                      'h-10 rounded-none border px-5 text-[11px] font-black tracking-[0.25em] transition-all',
                      active
                        ? 'text-[var(--bg)]'
                        : 'border-[var(--line)] bg-transparent text-[var(--ink-dim)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]',
                    )}
                    style={active ? { backgroundColor: accent, borderColor: accent } : undefined}
                  >
                    {g.name}
                  </button>
                )
              })}
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="mt-6 overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-soft)]">
              {boardLoading ? (
                <div className="py-16 text-center text-[11px] tracking-[0.3em] text-[var(--ink-faint)]">
                  FETCHING CORPSES…
                </div>
              ) : board.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-[9px] tracking-[0.3em] text-[var(--ink-faint)]">
                      <th className="px-5 py-3 text-left font-normal">RANK</th>
                      <th className="px-5 py-3 text-left font-normal">CALLSIGN</th>
                      <th className="px-5 py-3 text-right font-normal">SCORE</th>
                      <th className="hidden px-5 py-3 text-right font-normal sm:table-cell">
                        {activeMeta.boardCols[0]}
                      </th>
                      <th className="hidden px-5 py-3 text-right font-normal sm:table-cell">
                        {activeMeta.boardCols[1]}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.map((e, i) => (
                      <tr
                        key={e.id}
                        className="border-b border-[var(--line)] transition-colors last:border-0 hover:bg-[var(--bg)]"
                      >
                        <td className="px-5 py-3 text-[var(--ink-faint)]">
                          {i === 0 ? (
                            <span style={{ color: accentFor(activeMeta, theme) }}>#01</span>
                          ) : (
                            `#${String(i + 1).padStart(2, '0')}`
                          )}
                        </td>
                        <td className="px-5 py-3 font-bold text-[var(--ink)]">{e.name}</td>
                        <td className="px-5 py-3 text-right font-black" style={{ color: accentFor(activeMeta, theme) }}>
                          {e.score.toLocaleString()}
                        </td>
                        <td className="hidden px-5 py-3 text-right text-[var(--ink-dim)] sm:table-cell">
                          {activeMeta.fmtWave(e.wave)}
                        </td>
                        <td className="hidden px-5 py-3 text-right text-[var(--ink-dim)] sm:table-cell">
                          {activeMeta.fmtKills(e.kills)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-16 text-center text-[11px] tracking-[0.3em] text-[var(--ink-faint)]">
                  NO RUNS LOGGED FOR {activeMeta.name} — BE THE FIRST
                </div>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ==================================================== PILOT CARD */}
      {returning && lvl && pilot && (
        <section className="border-t border-[var(--line)] bg-[var(--bg-soft)] py-12">
          <div className="mx-auto max-w-7xl px-4 md:px-6">
            <div className="flex flex-col items-start justify-between gap-6 rounded border border-amber-900/40 bg-[var(--bg)] p-6 md:flex-row md:items-center">
              <div>
                <div className="text-[10px] tracking-[0.35em] text-amber-500/80">WELCOME BACK, PILOT</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-display text-3xl text-amber-400">LEVEL {lvl.level}</span>
                  <span className="text-[11px] tracking-widest text-[var(--ink-faint)]">
                    {pilot.runs} RUNS · {pilot.totalKills.toLocaleString()} KILLS ·{' '}
                    {fmtDuration(pilot.timePlayed)} IN THE PIT
                  </span>
                </div>
                <div className="mt-3 h-2 w-72 max-w-full overflow-hidden bg-[var(--line)]">
                  <div
                    className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-1000"
                    style={{ width: `${Math.min(100, (lvl.into / lvl.need) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 text-[10px] tracking-widest text-[var(--ink-faint)]">
                  {lvl.into}/{lvl.need} XP · BEST COMBO ×{pilot.bestCombo} ·{' '}
                  {pilot.achievements.length}/{ACHIEVEMENTS.length} ACHIEVEMENTS
                </div>
              </div>
              <Link href="/play">
                <Button
                  size="lg"
                  className="h-12 border border-amber-500 bg-amber-500 px-8 font-black tracking-[0.2em] text-black hover:bg-amber-400"
                >
                  <Play className="mr-2 h-4 w-4" /> CONTINUE THE FIGHT
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ======================================================= FOOTER */}
      <footer className="relative overflow-hidden border-t border-[var(--line)]">
        <div className="mx-auto max-w-7xl px-4 py-20 text-center md:px-6 md:py-28">
          <Reveal>
            <div className="text-[10px] tracking-[0.4em] text-[var(--ink-faint)]">LAST CALL</div>
            <h2 className="font-display mt-4 select-none text-[13vw] leading-[0.85] tracking-tight md:text-[7rem]">
              <span className="block text-[var(--ink)]">STOP SCROLLING.</span>
              <span className="brutal-outline block">START DYING.</span>
            </h2>
            <div className="mt-10">
              <Link href="/play">
                <Button
                  size="lg"
                  className="brutal-glow h-16 border border-[var(--accent)] bg-[var(--accent)] px-14 text-lg font-black tracking-[0.25em] text-white hover:brightness-110"
                >
                  <Play className="mr-3 h-6 w-6" /> ENTER THE ARENA
                </Button>
              </Link>
            </div>
          </Reveal>
        </div>

        <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] py-3" aria-hidden>
          <Marquee items={['DIE LOUD', 'RETRY FAST', 'CLIMB HIGH', 'BRUTAL FOREVER']} reverse duration={22} />
        </div>

        <div className="border-t border-[var(--line)]">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-[10px] tracking-[0.25em] text-[var(--ink-faint)] md:flex-row md:px-6">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-[var(--accent)] text-[9px] font-black text-white">
                B//
              </span>
              BRUTAL//GAMES — FAN-MADE TRIBUTE TO BRUTAL BY AHWOO
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link href="/privacy" className="transition-colors hover:text-[var(--ink)]">PRIVACY</Link>
              <Link href="/terms" className="transition-colors hover:text-[var(--ink)]">TERMS</Link>
              {rewardsEnabled && (
                <Link href="/rewards" className="text-amber-500 transition-colors hover:text-amber-400">
                  REWARDS
                </Link>
              )}
              <a href="#games" className="transition-colors hover:text-[var(--ink)]">ALL GAMES</a>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
