'use client'

// GameStage — the portal game host.
//
// Phase 1 (poster): server-rendered art + controls, ZERO game code loaded.
// Phase 2 (playing): the runner (src/games/<slug>/page.tsx) lazy-imports on
// Play click and mounts inside a reserved 16:9 container (CLS-safe). The
// stage drives: portal adapter events, the daily-challenge flow (server seed,
// UNRANKED offline fallback, run submission + input log), the rewards HUD
// (all games earn when the program is enabled), fullscreen and exit.
//
// The runner owns the canvas + engine; the stage never touches the engine.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Maximize2, Minimize2, Play, Trophy, X, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RewardsHud } from '@/components/RewardsHud'
import { GameArt } from '@/components/portal/GameArt'
import {
  OwnPortalAdapter,
  PerfOverlay,
  createInputRecorder,
  hashString,
  QualityMonitor,
  type InputRecorder,
  type RunSummary,
} from '@/game-kit'
import { recallPlayerName } from '@/lib/scores-client'
import { currentRunToken } from '@/lib/run-session-client'
import { mutatorFor } from '@/lib/daily/mutators'
import { useToast } from '@/hooks/use-toast'
import type { GameSlug } from '@/games/types'
import type { DailyInfo } from '@/games/runner-types'
import type { GamePhase, RunStats } from '@/game/types'

// lazy runners — engine chunks load ONLY when a game is actually played
const RUNNERS = {
  arena: dynamic(() => import('@/games/arena/page'), { ssr: false }),
  stack: dynamic(() => import('@/games/stack/page'), { ssr: false }),
  reflex: dynamic(() => import('@/games/reflex/page'), { ssr: false }),
  dodge: dynamic(() => import('@/games/dodge/page'), { ssr: false }),
  merge: dynamic(() => import('@/games/merge/page'), { ssr: false }),
} as const

export interface GameStageProps {
  slug: GameSlug
  title: string
  shortName: string
  tagline: string
  controlsDesktop: string
  controlsMobile: string
  controlsGamepad: string
  dailyEnabled: boolean
}

interface DailyRunResponse {
  ok?: boolean
  ranked?: boolean
  rank?: number
  error?: string
}

const GUEST_STREAK_KEY = 'brutal.daily.streak'

function readGuestStreak(): { current: number; longest: number; lastDateKey: string } | null {
  try {
    const raw = window.localStorage.getItem(GUEST_STREAK_KEY)
    return raw ? (JSON.parse(raw) as { current: number; longest: number; lastDateKey: string }) : null
  } catch {
    return null
  }
}

function writeGuestStreak(s: { current: number; longest: number; lastDateKey: string }): void {
  try {
    window.localStorage.setItem(GUEST_STREAK_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

function localDateKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterdayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** guest-side streak update (server owns streaks for signed-in players) */
function bumpGuestStreak(dateKey: string): void {
  const cur = readGuestStreak() ?? { current: 0, longest: 0, lastDateKey: '' }
  if (cur.lastDateKey === dateKey) return
  const next =
    cur.lastDateKey === yesterdayOf(dateKey)
      ? { current: cur.current + 1, longest: Math.max(cur.longest, cur.current + 1), lastDateKey: dateKey }
      : { current: 1, longest: Math.max(cur.longest, 1), lastDateKey: dateKey }
  writeGuestStreak(next)
}

export function GameStage(props: GameStageProps) {
  const { slug, title, shortName, tagline, dailyEnabled } = props
  const { toast } = useToast()

  const [mode, setMode] = useState<'poster' | 'playing'>('poster')
  const [ready, setReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [daily, setDaily] = useState<DailyInfo | null>(null)
  const [dailyWanted, setDailyWanted] = useState(false)
  const [hudPhase, setHudPhase] = useState<GamePhase>('menu')
  const [lastStats, setLastStats] = useState<RunStats | null>(null)
  const [dailyRank, setDailyRank] = useState<number | null>(null)

  const adapterRef = useRef<OwnPortalAdapter | null>(null)
  const recorderRef = useRef<InputRecorder | null>(null)
  const dailyRef = useRef<DailyInfo | null>(null)
  dailyRef.current = daily

  const Runner = RUNNERS[slug]

  // ?daily= deep link (from /daily or a shared challenge link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('daily')) setDailyWanted(true)
  }, [])

  // adapter lifecycle (analytics; the runner wraps this raw adapter in rules)
  useEffect(() => {
    const adapter = new OwnPortalAdapter()
    adapterRef.current = adapter
    void adapter.init()
    return () => {
      adapterRef.current = null
    }
  }, [])

  // ---- daily helpers --------------------------------------------------------

  const fetchDailySeed = useCallback(async (): Promise<DailyInfo> => {
    try {
      const res = await fetch(`/api/daily/seed?game=${slug}`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { dateKey: string; seed: number; mutator?: string | null }
        return {
          dateKey: data.dateKey,
          seed: data.seed,
          ranked: true,
          mutator: data.mutator ?? null,
        }
      }
    } catch {
      // fall through to local fallback
    }
    // offline / static deploy: local seed, explicitly UNRANKED
    const dateKey = localDateKey()
    return { dateKey, seed: hashString(`${slug}:${dateKey}:local-fallback`), ranked: false }
  }, [slug])

  const startPlay = useCallback(
    async (wantDaily: boolean) => {
      setDailyRank(null)
      if (wantDaily && dailyEnabled) {
        const info = await fetchDailySeed()
        setDaily(info)
        adapterRef.current?.trackEvent('daily_start', { game: slug, dateKey: info.dateKey })
      } else {
        setDaily(null)
      }
      setReady(false)
      setMode('playing')
    },
    [dailyEnabled, fetchDailySeed, slug],
  )

  const submitDailyRun = useCallback(
    async (summary: RunSummary, inputLog: string | null) => {
      const info = dailyRef.current
      if (!info) return
      const guestStreak = readGuestStreak()
      try {
        const res = await fetch('/api/daily/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            game: slug,
            dateKey: info.dateKey,
            name: recallPlayerName() || 'ANON',
            score: summary.score,
            durationMs: summary.durationMs,
            seed: info.seed,
            ranked: info.ranked,
            runToken: currentRunToken() ?? undefined,
            inputLog,
            clientStreak: guestStreak ?? undefined,
          }),
        })
        if (res.ok) {
          const data = (await res.json()) as DailyRunResponse & { countedToday?: boolean }
          setDailyRank(data.rank ?? null)
          if (info.ranked) {
            bumpGuestStreak(info.dateKey) // only counts if the run was real
            adapterRef.current?.trackEvent('daily_complete', {
              game: slug,
              score: summary.score,
              ranked: true,
            })
          }
          toast({
            title: data.ranked ? `DAILY RUN LOGGED — #${data.rank ?? '?'}` : 'DAILY RUN LOGGED (UNRANKED)',
            description: data.ranked
              ? 'Best score of the day counts. Unlimited tries.'
              : 'Offline seed — shown on the board but not ranked.',
          })
        } else if (res.status === 422) {
          toast({ title: 'RUN REJECTED', description: 'Score looked implausible for its duration.' })
        }
      } catch {
        // offline — the run stays local; try again next run
      }
    },
    [slug, toast],
  )

  // ---- stage callbacks (stable identity; runners depend on them) ------------

  const onPhaseRef = useRef<(p: 'menu' | 'playing' | 'paused' | 'gameover') => void>(() => {})
  const onRunEndRef = useRef<(s: RunSummary) => void>(() => {})
  const onReadyRef = useRef<() => void>(() => {})

  onPhaseRef.current = (p) => {
    setHudPhase(p)
    if (p === 'playing') {
      recorderRef.current?.stop() // clear any previous run
      recorderRef.current = createInputRecorder()
      recorderRef.current.start()
    }
  }

  onRunEndRef.current = (summary) => {
    const log = recorderRef.current?.stop() ?? null
    recorderRef.current = null
    adapterRef.current?.trackEvent('run_end', {
      game: slug,
      score: summary.score,
      durationMs: summary.durationMs,
    })
    setLastStats({
      score: summary.score,
      wave: summary.wave,
      kills: summary.kills,
      timeAlive: summary.durationMs / 1000,
      maxCombo: 0,
      bossesKilled: 0,
      overdrivesUsed: 0,
      eliteKills: 0,
    })
    if (dailyRef.current) {
      lastDailySummaryRef.current = summary
      void submitDailyRun(summary, log)
    }
  }

  // remember the last daily summary for the challenge button (slice 1)
  const lastDailySummaryRef = useRef<RunSummary | null>(null)

  onReadyRef.current = () => {
    setReady(true)
    adapterRef.current?.trackEvent('game_load', { game: slug })
  }

  const stage = useMemo(
    () => ({
      daily,
      adapter: adapterRef.current ?? undefined,
      onPhase: (p: 'menu' | 'playing' | 'paused' | 'gameover') => onPhaseRef.current(p),
      onRunEnd: (s: RunSummary) => onRunEndRef.current(s),
      onReady: () => onReadyRef.current(),
    }),
    // daily identity change is intentional (new challenge → fresh engine)
    [daily],
  )

  // daily run ended → WhatsApp challenge (roadmap slice 1, the growth loop).
  // wa.me deep links need no SDK; the ?daily= param re-opens the SAME seeded
  // challenge for the recipient. The mutator label rides the text so the
  // challenge reads as "today's special rule".
  const challengeAFriend = useCallback(
    (summary: RunSummary) => {
      const info = dailyRef.current
      if (!info) return
      adapterRef.current?.trackEvent('share_click', { game: slug, kind: 'challenge' })
      const mut = info.mutator ? mutatorFor(slug, info.mutator) : null
      const mutatorText = mut && mut.id !== 'none' ? ` — today's rule: ${mut.label} (${mut.rule})` : ''
      const url = `${window.location.origin}/games/${slug}?daily=1`
      const text = `I scored ${summary.score} on today's ${shortName} daily${mutatorText}. Same seed for everyone — beat me if you can: ${url}`
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      toast({
        title: 'CHALLENGE SENT',
        description: 'WhatsApp opened with today\'s seed. Forward it to your group.',
      })
    },
    [slug, shortName, toast],
  )

  // stop recording when leaving the game
  useEffect(() => {
    if (mode === 'poster') {
      recorderRef.current?.stop()
      recorderRef.current = null
    }
  }, [mode])

  // dev/QA perf overlay (?perf=1): fps + frame time + heap, zero bytes otherwise
  useEffect(() => {
    if (mode !== 'playing' || !PerfOverlay.wanted()) return
    const overlay = new PerfOverlay()
    overlay.mount()
    return () => overlay.destroy()
  }, [mode])

  // lite mode (roadmap slice 2): production FPS watcher. Degrades PAGE
  // effects (never engine internals — house rule) when the device cannot
  // hold ~50fps. data-quality on <html> drives the CSS kill-switches;
  // the QUALITY button cycles auto → lite → off (persisted).
  const qualityRef = useRef<QualityMonitor | null>(null)
  const [qualityMode, setQualityMode] = useState<'auto' | 'lite' | 'off'>('auto')

  useEffect(() => {
    if (mode !== 'playing') return
    const mon = new QualityMonitor((tier) => {
      document.documentElement.dataset.quality = tier === 0 ? 'full' : tier === 1 ? 'lite' : 'ultra'
    })
    qualityRef.current = mon
    setQualityMode(mon.state.mode)
    mon.start()
    return () => {
      mon.destroy()
      qualityRef.current = null
      delete document.documentElement.dataset.quality
    }
  }, [mode])

  const cycleQuality = useCallback(() => {
    const next = qualityRef.current?.cycleMode()
    if (next) setQualityMode(next)
  }, [])

  const toggleFullscreen = useCallback(() => {
    setFullscreen((f) => {
      const next = !f
      // engines listen to window resize — nudge them after the container swaps
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
      return next
    })
  }, [])

  const exit = useCallback(() => {
    setMode('poster')
    setFullscreen(false)
    setHudPhase('menu')
    setDailyWanted(false)
    window.scrollTo({ top: 0 })
  }, [])

  // Android back button: exiting a game should not leave the site
  useEffect(() => {
    if (mode !== 'playing') return
    const onPop = () => exit()
    window.addEventListener('popstate', onPop)
    window.history.pushState({ brutalStage: slug }, '')
    return () => window.removeEventListener('popstate', onPop)
  }, [mode, slug, exit])

  const shareGame = useCallback(() => {
    adapterRef.current?.trackEvent('share_click', { game: slug })
    const url = `${window.location.origin}/games/${slug}`
    const text = `Playing ${title} — ${tagline} ${url}`
    void (async () => {
      try {
        if (navigator.share) {
          await navigator.share({ title, text })
          return
        }
      } catch {
        // cancelled
      }
      try {
        await navigator.clipboard.writeText(text)
        toast({ title: 'LINK COPIED', description: 'Send it to someone who talks trash.' })
      } catch {
        toast({ title: 'COPY FAILED', description: 'Clipboard unavailable in this browser.' })
      }
    })()
  }, [slug, title, tagline, toast])

  // ---- render ----------------------------------------------------------------

  if (mode === 'poster') {
    return (
      <div className="relative w-full overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--panel)]">
        <div className="relative aspect-video w-full">
          <GameArt slug={slug} className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-[10px] tracking-[0.4em] text-white/60">
              {dailyWanted ? 'DAILY CHALLENGE · SAME SEED FOR EVERYONE' : `FREE · NO DOWNLOAD · ${shortName}`}
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.8)] md:text-6xl">
              {title}
            </h2>
            <p className="max-w-md text-xs text-white/70 md:text-sm">{tagline}</p>
            <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={() => void startPlay(dailyWanted)}
                className="h-14 w-56 border border-red-500/60 bg-red-600 text-base font-black tracking-widest text-white shadow-[0_0_30px_rgba(239,68,68,0.35)] hover:bg-red-500"
              >
                <Play className="mr-2 h-5 w-5" /> PLAY NOW
              </Button>
              {dailyEnabled && !dailyWanted && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => void startPlay(true)}
                  className="h-14 w-56 border-amber-500/60 bg-black/40 text-base font-black tracking-widest text-amber-400 hover:bg-amber-950/40"
                >
                  <Trophy className="mr-2 h-5 w-5" /> DAILY RUN
                </Button>
              )}
            </div>
            <div className="mt-1 text-[10px] tracking-[0.25em] text-white/40">
              THE GAME LOADS WHEN YOU PRESS PLAY — NOT BEFORE
            </div>
          </div>
        </div>
        {/* controls strip */}
        <div className="grid gap-px border-t border-[var(--line)] bg-[var(--line)] text-[11px] leading-relaxed md:grid-cols-3">
          <div className="bg-[var(--panel)] p-3">
            <span className="font-bold tracking-widest text-[var(--ink)]">DESKTOP — </span>
            <span className="text-[var(--ink-dim)]">{props.controlsDesktop}</span>
          </div>
          <div className="bg-[var(--panel)] p-3">
            <span className="font-bold tracking-widest text-[var(--ink)]">MOBILE — </span>
            <span className="text-[var(--ink-dim)]">{props.controlsMobile}</span>
          </div>
          <div className="bg-[var(--panel)] p-3">
            <span className="font-bold tracking-widest text-[var(--ink)]">GAMEPAD — </span>
            <span className="text-[var(--ink-dim)]">{props.controlsGamepad}</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-2">
          <button
            onClick={shareGame}
            className="text-[10px] tracking-[0.3em] text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]"
          >
            SHARE THIS GAME
          </button>
          <span className="text-[10px] tracking-[0.3em] text-[var(--ink-faint)]">NIGHT/DAY + SOUND TOGGLES LIVE IN-GAME</span>
        </div>
      </div>
    )
  }

  // playing mode — container reserves its box (CLS) and hosts the runner
  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 bg-black'
          : 'relative aspect-video max-h-[84vh] w-full overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--bg)]'
      }
    >
      {/* runner mounts its own <main h-full>; the loading veil covers it until ready */}
      {!ready && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--bg)]">
          <div className="h-1 w-48 overflow-hidden rounded bg-[var(--line)]">
            <div className="h-full w-1/3 animate-[loadingbar_1.1s_ease-in-out_infinite] bg-[var(--ink)]" />
          </div>
          <div className="text-[10px] tracking-[0.4em] text-[var(--ink-dim)]">LOADING {shortName}…</div>
        </div>
      )}
      <div className="absolute inset-0">
        <Runner stage={stage} />
      </div>

      {/* rewards HUD — passive; renders nothing while the program is off */}
      <RewardsHud phase={hudPhase} lastStats={lastStats} />

      {/* daily banner (+ mutator label + challenge CTA — roadmap slice 1) */}
      {daily && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded border border-amber-700/60 bg-black/70 px-3 py-1 text-[9px] tracking-[0.3em] text-amber-400">
          DAILY · {daily.dateKey}
          {daily.mutator && daily.mutator !== 'none' && (
            <span className="ml-2 rounded-sm bg-amber-500/20 px-1.5 py-0.5 text-[8px] tracking-[0.2em] text-amber-300">
              {mutatorFor(slug, daily.mutator).label}
            </span>
          )}
          {!daily.ranked && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-200/70">
              <WifiOff className="h-3 w-3" /> UNRANKED
            </span>
          )}
          {dailyRank && daily.ranked && <span className="ml-2 text-amber-200">BEST #{dailyRank}</span>}
        </div>
      )}

      {/* WhatsApp challenge CTA — appears after a daily run ends (slice 1) */}
      {daily && lastDailySummaryRef.current && hudPhase === 'gameover' && (
        <div className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2">
          <Button
            size="sm"
            className="h-8 border border-emerald-600/60 bg-emerald-600/90 font-black tracking-[0.25em] text-white shadow-[0_0_18px_rgba(16,185,129,0.35)] hover:bg-emerald-500"
            onClick={() => challengeAFriend(lastDailySummaryRef.current as RunSummary)}
          >
            CHALLENGE A FRIEND
          </Button>
        </div>
      )}

      {/* stage chrome */}
      <div className="absolute right-2 top-2 z-40 flex gap-2">
        <Button
          size="icon"
          variant="outline"
          className={`h-8 w-8 border-[var(--line-strong)] bg-[var(--panel)] text-[9px] font-black tracking-tighter ${
            qualityMode === 'lite' ? 'text-emerald-400' : 'text-[var(--ink-dim)] hover:text-[var(--ink)]'
          }`}
          onClick={cycleQuality}
          aria-label={`Quality mode: ${qualityMode}. Click to change.`}
          title={`QUALITY: ${qualityMode.toUpperCase()} (auto-degrades on slow devices)`}
        >
          {qualityMode === 'lite' ? 'LITE' : qualityMode === 'off' ? 'FULL' : 'AUTO'}
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink-dim)] hover:text-[var(--ink)]"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink-dim)] hover:text-red-400"
          onClick={exit}
          aria-label="Exit game"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
