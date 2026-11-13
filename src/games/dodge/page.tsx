'use client'

// BRUTAL//DODGE runner — full game experience hosted by the portal
// GameStage. The ENGINE lives untouched in src/game/dodge.ts; this runner
// mounts it through the kit shim.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { DodgeEvent, DodgeStats } from '@/game/dodge'
import { createGame } from './shim'
import { buildCtx, destroyCtx } from '@/game-kit'
import type { EngineHandle } from '../wrap-engine'
import type { StageProps } from '../runner-types'
import { subscribeGamepads } from '@/game/gamepad'
import { useTheme } from '@/lib/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import {
  recallPlayerName,
  rememberPlayerName,
  fetchBoard,
  submitScore,
  type BoardEntry,
  type BoardResult,
} from '@/lib/scores-client'
import { beginRun, endRun } from '@/lib/run-session-client'
import { RankAuthHint } from '@/components/portal/RankAuthHint'
import {
  ArrowLeft,
  Crosshair,
  Flame,
  Gamepad2,
  MousePointerClick,
  Play,
  RotateCcw,
  Share2,
  Timer,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'

type PagePhase = 'menu' | 'playing' | 'over'

const GAMES = [
  { href: '/play', label: 'ARENA', cls: 'text-red-400 hover:text-red-300' },
  { href: '/stack', label: 'STACK', cls: 'text-amber-400 hover:text-amber-300' },
  { href: '/reflex', label: 'REFLEX', cls: 'text-cyan-400 hover:text-cyan-300' },
  { href: '/merge', label: 'MERGE', cls: 'text-lime-400 hover:text-lime-300' },
]

export default function DodgeRunner({ stage }: { stage?: StageProps }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<EngineHandle<import('@/game/dodge').DodgeGame> | null>(null)
  const overSinceRef = useRef(0)
  const statsRef = useRef<DodgeStats | null>(null)

  const { theme } = useTheme()
  const { toast } = useToast()
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  const [phase, setPhase] = useState<PagePhase>('menu')
  const [score, setScore] = useState(0)
  const [distance, setDistance] = useState(0)
  const [overStats, setOverStats] = useState<DodgeStats | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [muted, setMuted] = useState(false)
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [boardMode, setBoardMode] = useState<'online' | 'local'>('online')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [rank, setRank] = useState<number | null>(null)
  const [best, setBest] = useState(0)
  const [bestDist, setBestDist] = useState(0)
  const [newBest, setNewBest] = useState(false)
  const [padConnected, setPadConnected] = useState(false)
  const [padId, setPadId] = useState('')

  const phaseRef = useRef<PagePhase>('menu')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    engineRef.current?.setTheme(theme)
  }, [theme])

  const applyBoard = useCallback((res: BoardResult) => {
    setBoard(res.scores)
    setBoardMode(res.mode)
  }, [])

  const refreshBoard = useCallback(async () => {
    applyBoard(await fetchBoard('dodge'))
  }, [applyBoard])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleEvent = (ev: DodgeEvent) => {
      if (ev.type === 'score') {
        setScore(ev.score)
        setDistance(ev.distance)
      } else if (ev.type === 'phase') {
        if (ev.phase === 'playing') {
          setPhase('playing')
          setScore(0)
          setDistance(0)
          setNewBest(false)
          // fresh server-side run session for this run (ranked submission)
          endRun()
          void beginRun('dodge')
        } else if (ev.phase === 'over') {
          window.setTimeout(() => {
            const stats = statsRef.current
            if (!stats) return
            setOverStats(stats)
            setSubmitted(false)
            setRank(null)
            setPhase('over')
            overSinceRef.current = performance.now()
            setBest((prev) => {
              if (stats.score > prev) {
                setNewBest(true)
                try {
                  window.localStorage.setItem('brutal.dodge.best', String(stats.score))
                } catch {
                  // storage unavailable
                }
                return stats.score
              }
              return prev
            })
            setBestDist((prev) => {
              const next = Math.max(prev, stats.distance)
              try {
                window.localStorage.setItem('brutal.dodge.bestdist', String(next))
              } catch {
                // ignore
              }
              return next
            })
          }, 800)
        }
      } else if (ev.type === 'gameover') {
        statsRef.current = ev.stats
      } else if (ev.type === 'padstart') {
        if (phaseRef.current === 'menu') {
          engineRef.current?.start()
        } else if (phaseRef.current === 'over' && performance.now() - overSinceRef.current > 450) {
          engineRef.current?.start()
        }
      }
    }
    const ctx = buildCtx({
      canvas,
      adapter: stage?.adapter,
      theme: () => themeRef.current,
      onThemeChange: () => () => {},
      daily: stage?.daily ?? null,
      events: {
        onPhase: (p) => stage?.onPhase?.(p),
        onGameOver: (summary) => stage?.onRunEnd?.(summary),
        onGameEvent: (ev) => handleEvent(ev as DodgeEvent),
      },
    })
    const handle = createGame(ctx)
    engineRef.current = handle
    handle.setTheme(theme)
    stage?.onReady?.()
    setName(recallPlayerName())
    try {
      const b = Number(window.localStorage.getItem('brutal.dodge.best'))
      if (Number.isFinite(b) && b > 0) setBest(b)
      const d = Number(window.localStorage.getItem('brutal.dodge.bestdist'))
      if (Number.isFinite(d) && d > 0) setBestDist(d)
    } catch {
      // storage unavailable
    }
    void refreshBoard()
    return () => {
      handle.destroy()
      destroyCtx(ctx)
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBoard, stage?.daily])

  useEffect(() => {
    return subscribeGamepads((connected, id) => {
      setPadConnected(connected)
      setPadId(id)
    })
  }, [])

  const start = useCallback(() => {
    engineRef.current?.start()
  }, [])

  // space: start / instant retry — hold to fly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')
      ) {
        return
      }
      if (phase === 'menu') {
        e.preventDefault()
        start()
      } else if (phase === 'over' && performance.now() - overSinceRef.current > 500) {
        e.preventDefault()
        start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, start])

  const retry = useCallback(() => {
    if (performance.now() - overSinceRef.current > 400) start()
  }, [start])

  const submit = async () => {
    const stats = overStats
    if (!stats || submitted || submitting) return
    if (stats.score <= 0) return
    const n = (name.trim() || 'ANON').slice(0, 16).toUpperCase()
    setSubmitting(true)
    try {
      const res = await submitScore('dodge', {
        name: n,
        score: stats.score,
        wave: stats.distance, // meters flown
        kills: stats.orbs, // orbs collected
      })
      setSubmitted(true)
      setRank(res.rank)
      setBoard(res.board)
      setBoardMode(res.mode)
      setNeedsAuth(Boolean(res.authRequired))
      rememberPlayerName(n)
    } catch {
      // user can retry
    } finally {
      setSubmitting(false)
    }
  }

  const shareScore = async () => {
    if (!overStats) return
    const url = `${window.location.origin}/dodge`
    const text = `I flew ${overStats.distance}m and scored ${overStats.score} in BRUTAL//DODGE — ${overStats.nearMisses} near-misses, ${overStats.orbs} orbs. Try not to explode. ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BRUTAL//DODGE', text })
        return
      }
    } catch {
      // cancelled — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'SCORE COPIED', description: 'Paste it anywhere. Talk trash responsibly.' })
    } catch {
      toast({ title: 'COPY FAILED', description: 'Clipboard unavailable in this browser.' })
    }
  }

  const toggleMute = () => {
    setMuted((m) => {
      engineRef.current?.setMuted(!m)
      return !m
    })
  }

  const renderBoard = (entries: BoardEntry[]) => (
    <table className="w-full text-xs">
      <tbody>
        {entries.map((e, i) => (
          <tr key={e.id} className="border-b border-violet-950/40 last:border-0">
            <td className="py-1.5 pr-2 text-[var(--ink-faint)]">{String(i + 1).padStart(2, '0')}</td>
            <td className="py-1.5 pr-2 font-bold text-[var(--ink)]">{e.name}</td>
            <td className="py-1.5 text-right text-violet-400">{e.score}</td>
            <td className="py-1.5 pl-3 text-right text-[var(--ink-faint)]">{e.wave}m</td>
            <td className="py-1.5 pl-3 text-right text-[var(--ink-faint)]">{e.kills} ORB</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <main className="relative h-full w-full select-none overflow-hidden bg-[var(--bg)] font-mono text-[var(--ink)]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none"
        aria-label="BRUTAL dodge — game viewport"
      />

      {/* ------------------------------------------------- IN-PLAY HUD */}
      {phase === 'playing' && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 text-center">
            <div className="text-5xl font-black tabular-nums tracking-tighter text-[var(--ink)] md:text-6xl">
              {String(score).padStart(4, '0')}
            </div>
            <div className="mt-1 text-[10px] tracking-[0.35em] text-violet-400">
              {distance}m · HOLD TO CLIMB
            </div>
          </div>
          <div className="absolute right-3 top-3 z-20 flex gap-2">
            <ThemeToggle className="h-9 w-16" />
            {padConnected && (
              <div
                className="flex h-9 items-center gap-1.5 rounded border border-violet-800/60 bg-[var(--panel)] px-2.5 text-[9px] tracking-widest text-violet-400"
                title={padId || 'gamepad connected'}
              >
                <Gamepad2 className="h-3.5 w-3.5" />
                PAD
              </div>
            )}
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink)] hover:border-violet-500 hover:text-violet-400"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </div>
          {best > 0 && (
            <div className="pointer-events-none absolute left-3 top-4 z-10 text-[10px] tracking-[0.3em] text-[var(--ink-faint)]">
              BEST <span className="text-[var(--ink-dim)]">{best}</span>
            </div>
          )}
        </>
      )}

      {/* ------------------------------------------------------- MENU */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-8 backdrop-blur-[2px]">
          <div className="w-full max-w-3xl">
            <div className="text-center">
              <Link
                href="/"
                className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded border border-[var(--line-strong)] bg-[var(--panel)] px-3 py-1.5 text-[10px] tracking-[0.3em] text-[var(--ink-dim)] transition-colors hover:border-violet-500 hover:text-violet-400"
              >
                <ArrowLeft className="h-3 w-3" /> BACK TO SITE
              </Link>
              <h1 className="font-display relative inline-block select-none text-6xl tracking-tight md:text-8xl">
                <span aria-hidden className="absolute -left-1 top-0 text-violet-800/60 blur-[2px]">
                  DODGE
                </span>
                <span aria-hidden className="absolute -right-1 top-0 text-violet-300/40 blur-[2px]">
                  DODGE
                </span>
                <span className="relative text-violet-400">DODGE</span>
              </h1>
              <p className="mt-2 text-[11px] tracking-[0.35em] text-[var(--ink-dim)] md:text-xs">
                ONE BUTTON · HOLD TO CLIMB · GRAZE FOR GLORY
              </p>
            </div>

            {/* stats + rules card */}
            <div className="mt-6 rounded border border-violet-900/50 bg-[var(--panel)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs tracking-widest text-[var(--ink-dim)]">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-violet-500" /> LOCAL RECORDS
                </div>
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">
                  BEST SCORE <span className="text-violet-400">{best}</span> · BEST DISTANCE{' '}
                  <span className="text-violet-400">{bestDist}m</span>
                </div>
              </div>
              <div className="mt-3 grid gap-1.5 text-[11px] leading-relaxed text-[var(--ink-dim)] md:grid-cols-3">
                <div className="rounded border border-[var(--line)] bg-[var(--bg-raise)] px-2.5 py-2">
                  <span className="text-violet-400">HOLD ANYTHING</span> — finger, space, pad
                  button. Burn upward, release to fall.
                </div>
                <div className="rounded border border-[var(--line)] bg-[var(--bg-raise)] px-2.5 py-2">
                  <span className="text-violet-300">GRAZE OBSTACLES</span> — a CLOSE miss pays +25.
                  Orbs pay +40. Greed is good.
                </div>
                <div className="rounded border border-[var(--line)] bg-[var(--bg-raise)] px-2.5 py-2">
                  <span className="text-red-400">RED WALLS KILL</span> — so does everything else.
                  Speed only ever goes up.
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button
                size="lg"
                className="h-14 w-64 border border-violet-500/60 bg-violet-600 text-lg font-black tracking-widest text-white shadow-[0_0_30px_rgba(167,139,250,0.35)] hover:bg-violet-500 hover:shadow-[0_0_44px_rgba(167,139,250,0.55)]"
                onClick={start}
              >
                <Play className="mr-2 h-5 w-5" />
                BURN OR DIE
              </Button>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] tracking-[0.25em]">
                {GAMES.map((g) => (
                  <Link key={g.href} href={g.href} className={`transition-colors ${g.cls}`}>
                    {g.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* leaderboard */}
            <div className="mt-6 rounded border border-violet-950/80 bg-[var(--panel)] p-4">
              <div className="mb-3 flex items-center justify-between text-xs tracking-widest text-[var(--ink-dim)]">
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-violet-500" /> DODGE — GLOBAL TOP 10
                </div>
                {boardMode === 'local' && (
                  <span className="text-[9px] tracking-widest text-[var(--ink-faint)]">LOCAL BOARD</span>
                )}
              </div>
              {board.length > 0 ? (
                renderBoard(board)
              ) : (
                <div className="py-4 text-center text-[11px] tracking-widest text-[var(--ink-faint)]">
                  NO FLIGHTS LOGGED YET — BE THE FIRST
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- GAME OVER */}
      {phase === 'over' && overStats && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-8 backdrop-blur-[1px]"
          onClick={retry}
        >
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-xs tracking-[0.4em] text-red-500">
                <Crosshair className="h-4 w-4" /> FLIGHT TERMINATED
              </div>
              <h2 className="font-display relative mt-2 inline-block select-none text-5xl tracking-tight md:text-7xl">
                <span className="relative text-red-500">WRECKED</span>
              </h2>
              {newBest && (
                <div className="mt-3 inline-flex items-center gap-2 rounded border border-violet-600/50 bg-violet-950/30 px-3 py-1 text-[11px] tracking-widest text-violet-400">
                  <Zap className="h-3.5 w-3.5" /> NEW LOCAL BEST
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded border border-violet-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">SCORE</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.score}</div>
              </div>
              <div className="rounded border border-violet-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">DISTANCE</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.distance}m</div>
              </div>
              <div className="rounded border border-violet-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">ORBS</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.orbs}</div>
              </div>
              <div className="rounded border border-violet-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">NEAR-MISSES</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.nearMisses}</div>
              </div>
            </div>

            <div className="mt-4 rounded border border-violet-950/80 bg-[var(--panel)] p-4">
              {!submitted ? (
                <form
                  className="flex flex-col gap-3 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submit()
                  }}
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 16))}
                    placeholder="CALLSIGN"
                    maxLength={16}
                    className="h-11 flex-1 border-violet-900/60 bg-[var(--bg-raise)] font-bold tracking-widest text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus-visible:ring-violet-500"
                    aria-label="Callsign for the leaderboard"
                  />
                  <Button
                    type="submit"
                    disabled={submitting || overStats.score <= 0}
                    className="h-11 border border-violet-500/60 bg-violet-600 font-black tracking-widest text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {submitting ? 'TRANSMITTING…' : 'SUBMIT SCORE'}
                  </Button>
                </form>
              ) : (
                <div className="py-1 text-center text-sm tracking-widest text-emerald-400">
                  SCORE LOGGED{rank ? ` — GLOBAL RANK #${rank}` : ''}
                  {boardMode === 'local' && (
                    <span className="ml-2 text-[10px] text-[var(--ink-faint)]">(LOCAL BOARD)</span>
                  )}
                </div>
              )}
              {needsAuth && <RankAuthHint />}
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-violet-950 bg-transparent text-[11px] tracking-widest text-[var(--ink-dim)] hover:border-violet-700 hover:text-violet-400"
                  onClick={() => void shareScore()}
                >
                  <Share2 className="mr-1.5 h-3.5 w-3.5" /> SHARE THIS RUN
                </Button>
              </div>
              <ScrollArea className="mt-4 max-h-48">{board.length > 0 && renderBoard(board)}</ScrollArea>
            </div>

            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-12 w-64 border border-violet-500/60 bg-violet-600 font-black tracking-widest text-white hover:bg-violet-500"
                onClick={start}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> FLY AGAIN
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-64 border-[var(--line-strong)] bg-transparent font-bold tracking-widest text-[var(--ink-dim)] hover:border-violet-700 hover:text-violet-400"
                onClick={() => {
                  setPhase('menu')
                  void refreshBoard()
                }}
              >
                MAIN MENU
              </Button>
            </div>
            <div className="mt-4 text-center">
              <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-[var(--ink-faint)]">
                <MousePointerClick className="h-3.5 w-3.5" /> TAP ANYWHERE — INSTANT RETRY
              </span>
            </div>
          </div>
        </div>
      )}

      {/* theme + mute on menu */}
      {phase === 'menu' && (
        <div className="absolute right-3 top-3 z-20 flex gap-2">
          <ThemeToggle />
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink)] hover:border-violet-500 hover:text-violet-400"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </main>
  )
}
