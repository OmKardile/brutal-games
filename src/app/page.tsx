'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ACHIEVEMENTS,
  fmtDuration,
  levelFromXp,
  loadPilot,
  type PilotData,
} from '@/game/pilot'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiUrl, fetchBoard as fetchBoardApi, type BoardEntry, type BoardTotals } from '@/lib/scores-client'
import { assetUrl } from '@/lib/assets'
import {
  Activity,
  Crosshair,
  Gamepad2,
  Globe,
  Keyboard,
  Layers,
  MousePointerClick,
  Play,
  Skull,
  Swords,
  Trophy,
  Zap,
  Zap as ZapIcon,
} from 'lucide-react'

type Totals = BoardTotals

// --------------------------------------------------------------- stack art

function StackTowerArt() {
  return (
    <svg viewBox="0 0 200 230" className="h-44 w-full" aria-hidden>
      {/* base block */}
      <polygon points="152,150 100,176 100,216 152,190" fill="#b91c1c" />
      <polygon points="48,150 100,176 100,216 48,190" fill="#7f1d1d" />
      <polygon points="100,124 152,150 100,176 48,150" fill="#ef4444" />
      {/* perfect middle block */}
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
      {/* sliding block */}
      <polygon points="160,72 124,90 124,118 160,100" fill="#b91c1c" />
      <polygon points="88,72 124,90 124,118 88,100" fill="#991b1b" />
      <polygon points="124,54 160,72 124,90 88,72" fill="#f87171" />
      {/* sparks */}
      <rect x="150" y="46" width="4" height="4" fill="#fde68a" />
      <rect x="171" y="60" width="3" height="3" fill="#fbbf24" />
      <rect x="140" y="32" width="3" height="3" fill="#fbbf24" />
      <rect x="163" y="24" width="4" height="4" fill="#fde68a" />
    </svg>
  )
}

// ---------------------------------------------------------------- bestiary

const BESTIARY = [
  {
    name: 'GRUNT',
    color: '#ff4444',
    shape: 'square',
    threat: 1,
    desc: 'Slow, relentless, everywhere. The bread and butter of the horde.',
  },
  {
    name: 'DARTER',
    color: '#ff9f1a',
    shape: 'dart',
    threat: 2,
    desc: 'Weaves in fast at 210 units/s. Punishes standing still.',
  },
  {
    name: 'SPLITTER',
    color: '#b8e62e',
    shape: 'orb',
    threat: 2,
    desc: 'Pops into two furious minis when it dies. Kill it mid-dash.',
  },
  {
    name: 'SPITTER',
    color: '#ff5c8a',
    shape: 'pentagon',
    threat: 3,
    desc: 'Keeps distance and fires 3-round bursts. Flank it, don\u2019t chase it.',
  },
  {
    name: 'TANK',
    color: '#b91c1c',
    shape: 'hex',
    threat: 4,
    desc: '250 HP of armored hatred. Barely flinches at knockback.',
  },
  {
    name: 'THE BRUTE',
    color: '#ff2222',
    shape: 'spike',
    threat: 5,
    desc: 'Every 5th wave. Radial bullet storms, spawns minions, enrages at 30%. Pray.',
  },
]

function EnemyGlyph({ shape, color }: { shape: string; color: string }) {
  const common = { fill: color, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.5 }
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden>
      {shape === 'square' && (
        <rect x="14" y="14" width="36" height="36" rx="3" transform="rotate(45 32 32)" {...common} />
      )}
      {shape === 'dart' && (
        <polygon points="56,32 12,50 24,32 12,14" {...common} />
      )}
      {shape === 'orb' && (
        <>
          <circle cx="32" cy="32" r="19" {...common} />
          <circle cx="32" cy="32" r="9" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="3" />
        </>
      )}
      {shape === 'pentagon' && (
        <polygon points="32,10 54,26 46,52 18,52 10,26" {...common} />
      )}
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

// ---------------------------------------------------------------- page

export default function LandingPage() {
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [pilot, setPilot] = useState<PilotData | null>(null)
  const [rewardsEnabled, setRewardsEnabled] = useState(false)

  useEffect(() => {
    setPilot(loadPilot())
    const load = async () => {
      // online arena board; local-board fallback on static deployments
      const res = await fetchBoardApi('arena')
      setBoard(res.scores)
      setTotals(res.totals)
    }
    void load()
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
  }, [])

  const lvl = pilot ? levelFromXp(pilot.xp) : null
  const returning = !!pilot && pilot.runs > 0

  return (
    <main className="min-h-dvh w-full overflow-x-clip bg-[#070709] font-mono text-stone-200">
      {/* ------------------------------------------------------------- NAV */}
      <nav className="sticky top-0 z-50 border-b border-red-950/60 bg-[#070709]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-red-600 text-xs font-black text-white">
              B//
            </span>
            <span className="text-sm font-black tracking-[0.25em] text-stone-200">
              BRUTAL<span className="text-red-500">//</span>ARENA
            </span>
          </Link>
          <div className="hidden items-center gap-6 text-[11px] tracking-[0.25em] text-stone-500 md:flex">
            <a href="#games" className="transition-colors hover:text-red-400">GAMES</a>
            <a href="#features" className="transition-colors hover:text-red-400">FEATURES</a>
            <a href="#bestiary" className="transition-colors hover:text-red-400">BESTIARY</a>
            <a href="#leaderboard" className="transition-colors hover:text-red-400">LEADERBOARD</a>
            <a href="#howto" className="transition-colors hover:text-red-400">HOW TO PLAY</a>
            <Link href="/stack" className="text-amber-500 transition-colors hover:text-amber-400">
              STACK
            </Link>
            {rewardsEnabled && (
              <Link href="/rewards" className="text-amber-500 transition-colors hover:text-amber-400">
                REWARDS
              </Link>
            )}
          </div>
          <Link href="/play">
            <Button className="h-9 border border-red-500/60 bg-red-600 px-5 text-xs font-black tracking-[0.2em] text-white hover:bg-red-500">
              <Play className="mr-1.5 h-3.5 w-3.5" /> PLAY NOW
            </Button>
          </Link>
        </div>
      </nav>

      {/* ------------------------------------------------------------- HERO */}
      <section className="relative overflow-hidden">
        {/* real-world backdrop */}
        <div className="absolute inset-0">
          <Image
            src={assetUrl("/images/arena_bg.jpg")}
            alt="A burning street at night — the arena awaits"
            fill
            priority
            className="object-cover object-center opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#070709]/60 via-[#070709]/75 to-[#070709]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#070709]/80 via-transparent to-[#070709]/60" />
        </div>
        <div className="brutal-scanline" />
        <div className="brutal-grain absolute inset-0 opacity-60" />

        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-16 md:grid-cols-[1.15fr_0.85fr] md:pt-24">
          <div className="flex flex-col items-start justify-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-red-900/70 bg-black/50 px-3 py-1 text-[10px] tracking-[0.3em] text-red-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              FREE TO PLAY — NO DOWNLOAD · OPTIONAL ACCOUNT
            </div>
            <h1 className="brutal-flicker text-5xl font-black leading-[0.95] tracking-tighter text-stone-100 md:text-7xl">
              SURVIVE
              <br />
              THE ARENA.
              <br />
              <span className="text-red-500">DIE LOUD.</span>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-stone-400">
              A fast, brutal top-down wave shooter. Draft upgrades between waves,
              chain killstreaks, charge <span className="text-amber-400">OVERDRIVE</span>,
              and put your callsign on the global board. One run is 3 minutes —
              &ldquo;one more run&rdquo; is 2 hours.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/play" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="brutal-glow h-14 w-full border border-red-500/70 bg-red-600 px-10 text-base font-black tracking-[0.2em] text-white hover:bg-red-500 sm:w-auto"
                >
                  <Play className="mr-2 h-5 w-5" /> ENTER THE ARENA
                </Button>
              </Link>
              <Link href="/play?wave=5" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 w-full border-amber-800/70 bg-black/50 px-8 text-sm font-black tracking-[0.2em] text-amber-400 hover:border-amber-500 hover:text-amber-300 sm:w-auto"
                >
                  <ZapIcon className="mr-2 h-4 w-4" /> BOSS RUSH — WAVE 5
                </Button>
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] tracking-[0.25em] text-stone-500">
              <span className="flex items-center gap-1.5">
                <Keyboard className="h-3.5 w-3.5 text-red-500" /> KEYBOARD
              </span>
              <span className="flex items-center gap-1.5">
                <MousePointerClick className="h-3.5 w-3.5 text-red-500" /> MOUSE
              </span>
              <span className="flex items-center gap-1.5">
                <Gamepad2 className="h-3.5 w-3.5 text-red-500" /> TOUCH
              </span>
              <span className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-red-500" /> GLOBAL SCORES
              </span>
            </div>
          </div>

          {/* character art card */}
          <div className="relative hidden items-center justify-center md:flex">
            <div className="brutal-float relative w-72 rotate-2 overflow-hidden rounded border border-red-900/60 bg-black/60 shadow-[0_0_60px_rgba(239,68,68,0.25)]">
              <Image
                src={assetUrl("/images/hero_char.jpg")}
                alt="Armored pilot of the arena"
                width={448}
                height={600}
                className="h-auto w-full"
              />
              <div className="border-t border-red-950/70 bg-black/70 px-4 py-3">
                <div className="flex items-center justify-between text-[10px] tracking-[0.25em]">
                  <span className="text-stone-500">PILOT</span>
                  <span className="text-red-400">STATUS: ARMED</span>
                </div>
              </div>
            </div>
            {/* floating kill chips */}
            <div
              className="brutal-chip absolute -left-2 top-10 rounded border border-amber-700/60 bg-black/80 px-3 py-1.5 text-xs font-black tracking-widest text-amber-400"
              style={{ ['--chip-rot' as string]: '-6deg', animationDelay: '0s' }}
            >
              +480 PTS
            </div>
            <div
              className="brutal-chip absolute -right-3 top-1/3 rounded border border-red-800/70 bg-black/80 px-3 py-1.5 text-xs font-black tracking-widest text-red-400"
              style={{ ['--chip-rot' as string]: '5deg', animationDelay: '1.2s' }}
            >
              RAMPAGE ×20
            </div>
            <div
              className="brutal-chip absolute -bottom-2 left-8 rounded border border-emerald-800/60 bg-black/80 px-3 py-1.5 text-xs font-black tracking-widest text-emerald-400"
              style={{ ['--chip-rot' as string]: '3deg', animationDelay: '2.1s' }}
            >
              BRUTE DOWN
            </div>
          </div>
        </div>

        {/* live war-room ticker */}
        <div className="relative border-y border-red-950/60 bg-black/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-4 py-3 text-[10px] tracking-[0.3em] text-stone-500">
            <span className="flex items-center gap-2 text-red-400">
              <Activity className="h-3.5 w-3.5" /> LIVE WAR ROOM
            </span>
            <span>
              RUNS LOGGED:{' '}
              <span className="font-bold text-stone-200">
                {(totals?.runs ?? 0).toLocaleString()}
              </span>
            </span>
            <span>
              CONFIRMED KILLS:{' '}
              <span className="font-bold text-stone-200">
                {(totals?.kills ?? 0).toLocaleString()}
              </span>
            </span>
            <span>
              TOP SCORE:{' '}
              <span className="font-bold text-amber-500">
                {(totals?.top ?? 0).toLocaleString()}
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- GAME SELECT */}
      <section id="games" className="border-b border-red-950/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.4em] text-red-500">TWO WAYS TO BLEED</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-4xl">
              CHOOSE YOUR GAME
            </h2>
            <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-stone-500">
              Same pit, two disciplines. Mow the horde down in the arena — or freeze
              your hands and stack the perfect tower.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {/* ARENA card */}
            <Link
              href="/play"
              className="group relative overflow-hidden rounded border border-red-950/80 bg-black/50 transition-all hover:-translate-y-1 hover:border-red-500/70 hover:shadow-[0_0_40px_rgba(239,68,68,0.2)]"
            >
              <div className="relative h-44 overflow-hidden border-b border-red-950/70">
                <Image
                  src={assetUrl("/images/shots/shot-game.jpg")}
                  alt="BRUTAL ARENA — top-down wave shooter gameplay"
                  fill
                  className="object-cover opacity-70 transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                <Badge
                  variant="outline"
                  className="absolute left-3 top-3 border-red-800/70 bg-black/70 text-[9px] tracking-[0.25em] text-red-400"
                >
                  TWIN-STICK SHOOTER
                </Badge>
              </div>
              <div className="p-5">
                <h3 className="text-xl font-black tracking-tight text-stone-100">
                  BRUTAL <span className="text-red-500">//</span> ARENA
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-stone-400">
                  Top-down wave survival. Draft upgrades between waves, chain
                  killstreaks, charge OVERDRIVE, and kill the Brute every 5th wave.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tracking-[0.25em] text-stone-500">
                  <span className="text-red-400">WASD + MOUSE</span>
                  <span>·</span>
                  <span>TOUCH</span>
                  <span>·</span>
                  <span>~3 MIN RUNS</span>
                </div>
              </div>
            </Link>
            {/* STACK card */}
            <Link
              href="/stack"
              className="group relative overflow-hidden rounded border border-amber-950/80 bg-black/50 transition-all hover:-translate-y-1 hover:border-amber-500/70 hover:shadow-[0_0_40px_rgba(245,158,11,0.2)]"
            >
              <div className="relative h-44 overflow-hidden border-b border-amber-950/70 bg-[radial-gradient(ellipse_at_50%_30%,rgba(120,53,15,0.25),transparent_70%)]">
                <StackTowerArt />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                <Badge
                  variant="outline"
                  className="absolute left-3 top-3 border-amber-800/70 bg-black/70 text-[9px] tracking-[0.25em] text-amber-400"
                >
                  NEW — ONE-TAP TOWER
                </Badge>
              </div>
              <div className="p-5">
                <h3 className="text-xl font-black tracking-tight text-stone-100">
                  BRUTAL <span className="text-amber-500">//</span> STACK
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-stone-400">
                  One tap. Drop the block, slice the overhang, chain PERFECT drops to
                  regrow the tower. How high before it all collapses?
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tracking-[0.25em] text-stone-500">
                  <span className="text-amber-400">SINGLE TAP</span>
                  <span>·</span>
                  <span>30-SECOND RUNS</span>
                  <span>·</span>
                  <span>INSTANT RETRY</span>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- PILOT CARD */}
      {returning && lvl && pilot && (
        <section className="border-b border-red-950/40 bg-gradient-to-b from-red-950/15 to-transparent">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="flex flex-col items-start justify-between gap-6 rounded border border-amber-900/40 bg-black/50 p-6 md:flex-row md:items-center">
              <div>
                <div className="text-[10px] tracking-[0.35em] text-amber-500/80">
                  WELCOME BACK, PILOT
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-2xl font-black text-amber-400">
                    LEVEL {lvl.level}
                  </span>
                  <span className="text-[11px] tracking-widest text-stone-500">
                    {pilot.runs} RUNS · {pilot.totalKills.toLocaleString()} KILLS ·{' '}
                    {fmtDuration(pilot.timePlayed)} IN THE PIT
                  </span>
                </div>
                <div className="mt-3 h-2 w-64 max-w-full overflow-hidden rounded-sm bg-stone-900">
                  <div
                    className="h-full bg-gradient-to-r from-amber-600 to-amber-400"
                    style={{ width: `${Math.min(100, (lvl.into / lvl.need) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 text-[10px] tracking-widest text-stone-600">
                  {lvl.into}/{lvl.need} XP · BEST COMBO ×{pilot.bestCombo} ·{' '}
                  {pilot.achievements.length}/{ACHIEVEMENTS.length} ACHIEVEMENTS
                </div>
              </div>
              <Link href="/play">
                <Button
                  size="lg"
                  className="h-12 border border-amber-600/60 bg-amber-600 px-8 font-black tracking-[0.2em] text-black hover:bg-amber-500"
                >
                  <Play className="mr-2 h-4 w-4" /> CONTINUE THE FIGHT
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------- FEATURES */}
      <section id="features" className="border-b border-red-950/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.4em] text-red-500">WHAT MAKES IT BRUTAL</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-4xl">
              SIX WAYS TO DIE GLORIOUSLY
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Swords,
                title: 'DRAFT UPGRADES',
                desc: 'Clear a wave, pick 1 of 3 upgrades — 12 stackable builds from Rail Slugs to Orbital Saws. Every run plays different.',
                accent: 'text-red-400',
              },
              {
                icon: Skull,
                title: '7 ENEMY TYPES',
                desc: 'Grunt hordes, weaving darters, splitting blobs, burst-fire spitters, armored tanks — and the Brute every 5 waves.',
                accent: 'text-red-400',
              },
              {
                icon: Zap,
                title: 'OVERDRIVE',
                desc: 'Kills charge your meter. Press E: the world slows to 55%, your damage and fire rate double. Five seconds of godhood.',
                accent: 'text-amber-400',
              },
              {
                icon: Crosshair,
                title: 'ELITE HUNTS',
                desc: 'Golden-aura elites from wave 3: 2.2× HP, faster, worth 3× score. High risk, fat reward, louder explosions.',
                accent: 'text-amber-400',
              },
              {
                icon: Activity,
                title: 'COMBO STREAKS',
                desc: 'Chain kills without taking damage: KILLING SPREE → RAMPAGE → MASSACRE → UNSTOPPABLE. Score multipliers up to ×8.',
                accent: 'text-red-400',
              },
              {
                icon: Trophy,
                title: 'RANK + LEVEL UP',
                desc: 'Score = XP. Climb pilot levels, unlock 10 achievements, submit runs to the global top 10, and share your best death.',
                accent: 'text-amber-400',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="group rounded border border-red-950/70 bg-black/40 p-5 transition-all hover:-translate-y-1 hover:border-red-800/70 hover:bg-red-950/20"
              >
                <f.icon className={`h-6 w-6 ${f.accent}`} />
                <div className="mt-3 text-sm font-black tracking-widest text-stone-100">
                  {f.title}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-stone-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ SCREENSHOTS */}
      <section className="border-b border-red-950/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.4em] text-red-500">CAPTURED IN THE PIT</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-4xl">
              THIS IS WHAT YOU&rsquo;RE UP AGAINST
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { src: assetUrl('/images/shots/shot-game.jpg'), label: 'WAVE 6 — FULL CONTACT', alt: 'Mid-run combat in the arena' },
              { src: assetUrl('/images/shots/shot-boss.jpg'), label: 'THE BRUTE — WAVE 5 BOSS', alt: 'The Brute boss fight' },
              { src: assetUrl('/images/shots/shot-menu.jpg'), label: 'PRE-DROP BRIEFING', alt: 'Pre-run briefing screen' },
            ].map((s) => (
              <figure
                key={s.src}
                className="group relative overflow-hidden rounded border border-red-950/70 bg-black/60"
              >
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={s.src}
                    alt={s.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                </div>
                <figcaption className="absolute bottom-0 left-0 right-0 px-3 py-2 text-[10px] tracking-[0.25em] text-stone-300">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                  {s.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- BESTIARY */}
      <section id="bestiary" className="border-b border-red-950/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.4em] text-red-500">FIELD INTELLIGENCE</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-4xl">
              KNOW YOUR ENEMY
            </h2>
          </div>

          {/* boss art banner */}
          <div className="relative mt-10 overflow-hidden rounded border border-red-900/60">
            <Image
              src={assetUrl("/images/boss_art.jpg")}
              alt="The Brute — boss of the arena"
              width={1600}
              height={900}
              className="h-56 w-full object-cover object-center opacity-90 md:h-72"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-center px-6 md:px-10">
              <div className="flex items-center gap-2 text-[10px] tracking-[0.35em] text-red-400">
                <Skull className="h-4 w-4" /> END OF WAVE 5. 10. 15. 20…
              </div>
              <div className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-5xl">
                THE BRUTE
              </div>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-stone-300">
                750+ HP. Radial bullet storms. Spawns grunt packs. Enrages below 30%
                health. Killing it drops a full repair kit — if you live long enough
                to grab it.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BESTIARY.map((b) => (
              <div
                key={b.name}
                className="flex items-start gap-4 rounded border border-red-950/70 bg-black/40 p-4 transition-colors hover:border-red-900"
              >
                <EnemyGlyph shape={b.shape} color={b.color} />
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black tracking-widest" style={{ color: b.color }}>
                      {b.name}
                    </span>
                    <span className="shrink-0 text-[9px] tracking-widest text-stone-600">
                      {'▮'.repeat(b.threat)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-stone-400">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ HOW TO */}
      <section id="howto" className="border-b border-red-950/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.4em] text-red-500">ZERO TO KILLING IN 30 SECONDS</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-4xl">
              HOW TO PLAY
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                n: '01',
                title: 'MOVE & SHOOT',
                body: 'WASD to move, mouse to aim, hold left-click to fire. On touch: left thumb moves, right thumb aims and fires. Dash with SPACE for invincibility frames.',
              },
              {
                n: '02',
                title: 'SURVIVE & DRAFT',
                body: 'Every cleared wave offers 3 upgrades. Stack them into a build — multishot, piercing rails, orbiting sawblades. Elites glow gold: kill them for triple score.',
              },
              {
                n: '03',
                title: 'OVERDRIVE & RANK',
                body: 'Kills fill the gold OVERDRIVE meter — press E for slow-mo double damage. Die, submit your score, earn XP, level up, run it back with R.',
              },
            ].map((s) => (
              <div key={s.n} className="rounded border border-red-950/70 bg-black/40 p-5">
                <div className="text-3xl font-black text-red-800">{s.n}</div>
                <div className="mt-2 text-sm font-black tracking-widest text-stone-100">
                  {s.title}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-stone-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- LEADERBOARD */}
      <section id="leaderboard" className="border-b border-red-950/40 py-16">
        <div className="mx-auto max-w-3xl px-4">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.4em] text-red-500">THE GLOBAL TOP 10</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-100 md:text-4xl">
              CLAIM YOUR CALLSIGN
            </h2>
            <p className="mt-3 text-xs leading-relaxed text-stone-500">
              Player-submitted after real deaths. The board is live — one good run
              puts you on it.
            </p>
          </div>
          <div className="mt-8 rounded border border-red-950/80 bg-black/50 p-4">
            {board.length === 0 ? (
              <div className="py-8 text-center text-xs tracking-widest text-stone-600">
                NO SURVIVORS LOGGED YET —{' '}
                <Link href="/play" className="text-red-400 hover:text-red-300">
                  BE THE FIRST
                </Link>
              </div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {board.map((e, i) => (
                    <tr key={e.id} className="border-b border-red-950/40 last:border-0">
                      <td className="py-2 pr-3 text-stone-600">
                        {String(i + 1).padStart(2, '0')}
                      </td>
                      <td className="py-2 pr-3 font-bold text-stone-200">{e.name}</td>
                      <td className="py-2 text-right text-amber-500">
                        {e.score.toLocaleString()}
                      </td>
                      <td className="py-2 pl-3 text-right text-stone-500">W{e.wave}</td>
                      <td className="py-2 pl-3 text-right text-stone-500">
                        {e.kills} KILLS
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-6 text-center">
            <Link href="/play">
              <Button
                size="lg"
                className="h-12 border border-red-500/60 bg-red-600 px-10 font-black tracking-[0.2em] text-white hover:bg-red-500"
              >
                <Play className="mr-2 h-4 w-4" /> PUT ME ON THAT BOARD
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- FINAL CTA */}
      <section className="relative overflow-hidden py-24">
        <div className="absolute inset-0">
          <Image
            src={assetUrl("/images/arena_bg.jpg")}
            alt=""
            fill
            className="object-cover object-bottom opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#070709] via-[#070709]/70 to-[#070709]" />
        </div>
        <div className="brutal-scanline" />
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <div className="text-[10px] tracking-[0.4em] text-red-500">NO EXCUSES LEFT</div>
          <h2 className="mt-3 text-4xl font-black leading-tight tracking-tighter text-stone-100 md:text-6xl">
            STOP READING.
            <br />
            <span className="text-red-500">START SHOOTING.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-stone-400">
            The arena is open right now. It&rsquo;s free, it&rsquo;s fast, and it&rsquo;s
            already counting your deaths.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/play">
              <Button
                size="lg"
                className="brutal-glow h-14 w-72 border border-red-500/70 bg-red-600 text-base font-black tracking-[0.2em] text-white hover:bg-red-500"
              >
                <Play className="mr-2 h-5 w-5" /> PLAY FREE NOW
              </Button>
            </Link>
            <Link href="/play?wave=5">
              <Button
                size="lg"
                variant="outline"
                className="h-14 w-72 border-amber-800/70 bg-black/50 text-sm font-black tracking-[0.2em] text-amber-400 hover:border-amber-500 hover:text-amber-300"
              >
                <ZapIcon className="mr-2 h-4 w-4" /> STRAIGHT TO THE BRUTE
              </Button>
            </Link>
          </div>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Badge variant="outline" className="border-red-900/60 text-[10px] tracking-[0.25em] text-stone-500">
              AVG RUN: 3 MIN · MOBILE FRIENDLY · SCREENSHAKE INCLUDED
            </Badge>
            <Link
              href="/stack"
              className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.25em] text-stone-500 transition-colors hover:text-amber-400"
            >
              <Layers className="h-3.5 w-3.5" /> NO PATIENCE? ONE-TAP STACK GAME
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ FOOTER */}
      <footer className="border-t border-red-950/50 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-red-600 text-[10px] font-black text-white">
              B//
            </span>
            <span className="text-xs font-black tracking-[0.25em] text-stone-400">
              BRUTAL<span className="text-red-500">//</span>ARENA
            </span>
          </div>
          <p className="max-w-xl text-[10px] leading-relaxed tracking-wider text-stone-600">
            A fan-made arena shooter tribute to BRUTAL, the open-source C# game
            framework by ahwoo — github.com/ahwootech/BRUTAL. Not affiliated, just
            respect. Built with a canvas engine, WebAudio synth SFX, and a leaderboard
            that never lies.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-[10px] tracking-[0.2em] text-stone-600">
            {rewardsEnabled && (
              <Link href="/rewards" className="text-amber-600 transition-colors hover:text-amber-500">
                REWARDS PROGRAM
              </Link>
            )}
            <Link href="/terms" className="transition-colors hover:text-stone-400">
              TERMS
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-stone-400">
              PRIVACY
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
