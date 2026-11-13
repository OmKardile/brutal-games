'use client'

// BRUTAL//MERGE runner — full game experience hosted by the portal
// GameStage. The ENGINE lives untouched in src/game/merge.ts; this runner
// mounts it through the kit shim.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { MergeEvent, MergeStats } from '@/game/merge'
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
  Atom,
  Crosshair,
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
  { href: '/dodge', label: 'DODGE', cls: 'text-violet-400 hover:text-violet-300' },
]

// tier color chips for the menu fusion chain
const TIER_COLORS = [
  '#8b1f1f',
  '#b91c1c',
  '#dc2626',
  '#ea580c',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#facc15',
  '#fde047',
  '#fef9c3',
  '#ffffff',
]

export default function MergeRunner({ stage }: { stage?: StageProps }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<EngineHandle<import('@/game/merge').MergeGame> | null>(null)
  const overSinceRef = useRef(0)
  const statsRef = useRef<MergeStats | null>(null)

  const { theme } = useTheme()
  const { toast } = useToast()
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  const [phase, setPhase] = useState<PagePhase>('menu')
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(1)
  const [tier, setTier] = useState(1)
  const [overStats, setOverStats] = useState<MergeStats | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [muted, setMuted] = useState(false)
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [boardMode, setBoardMode] = useState<'online' | 'local'>('online')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [rank, setRank] = useState<number | null>(null)
  const [best, setBest] = useState(0)
  const [bestTier, setBestTier] = useState(0)
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
    applyBoard(await fetchBoard('merge'))
  }, [applyBoard])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleEvent = (ev: MergeEvent) => {
      if (ev.type === 'score') {
        setScore(ev.score)
        setCombo(ev.combo)
        setTier(ev.tier)
      } else if (ev.type === 'phase') {
        if (ev.phase === 'playing') {
          setPhase('playing')
          setScore(0)
          setCombo(1)
          setTier(1)
          setNewBest(false)
          // fresh server-side run session for this run (ranked submission)
          endRun()
          void beginRun('merge', stage?.daily ? { seed: stage.daily.seed } : undefined)
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
                  window.localStorage.setItem('brutal.merge.best', String(stats.score))
                } catch {
                  // storage unavailable
                }
                return stats.score
              }
              return prev
            })
            setBestTier((prev) => {
              const next = Math.max(prev, stats.highestTier)
              try {
                window.localStorage.setItem('brutal.merge.besttier', String(next))
              } catch {
                // ignore
              }
              return next
            })
          }, 900)
        }
      } else if (ev.type === 'gameover') {
        statsRef.current = ev.stats
      } else if (ev.type === 'padstart') {
        if (phaseRef.current === 'menu') {
          engineRef.current?.start()
        } else if (phaseRef.current === 'over' && performance.now() - overSinceRef.current > 500) {
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
        onGameEvent: (ev) => handleEvent(ev as MergeEvent),
      },
    })
    const handle = createGame(ctx)
    engineRef.current = handle
    handle.setTheme(theme)
    stage?.onReady?.()
    setName(recallPlayerName())
    try {
      const b = Number(window.localStorage.getItem('brutal.merge.best'))
      if (Number.isFinite(b) && b > 0) setBest(b)
      const t = Number(window.localStorage.getItem('brutal.merge.besttier'))
      if (Number.isFinite(t) && t > 0) setBestTier(t)
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
      const res = await submitScore('merge', {
        name: n,
        score: stats.score,
        wave: stats.highestTier, // highest tier forged
        kills: stats.merges, // total fusions
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
    const url = `${window.location.origin}/merge`
    const text = `I scored ${overStats.score} in BRUTAL//MERGE — forged tier ${overStats.highestTier}/11, ${overStats.merges} fusions, best combo ×${overStats.bestCombo}${overStats.singularities > 0 ? `, ${overStats.singularities} SINGULARITY${overStats.singularities > 1 ? 'IES' : ''}` : ''}. ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BRUTAL//MERGE', text })
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
          <tr key={e.id} className="border-b border-lime-950/40 last:border-0">
            <td className="py-1.5 pr-2 text-[var(--ink-faint)]">{String(i + 1).padStart(2, '0')}</td>
            <td className="py-1.5 pr-2 font-bold text-[var(--ink)]">{e.name}</td>
            <td className="py-1.5 text-right text-lime-500">{e.score}</td>
            <td className="py-1.5 pl-3 text-right text-[var(--ink-faint)]">T{e.wave}</td>
            <td className="py-1.5 pl-3 text-right text-[var(--ink-faint)]">{e.kills} FUSE</td>
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
        aria-label="BRUTAL merge — game viewport"
      />

      {/* ------------------------------------------------- IN-PLAY HUD */}
      {phase === 'playing' && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 text-center">
            <div className="text-5xl font-black tabular-nums tracking-tighter text-[var(--ink)] md:text-6xl">
              {String(score).padStart(4, '0')}
            </div>
            {combo >= 2 && (
              <div className="mt-1 text-xs font-black tracking-[0.3em] text-lime-400">
                CHAIN ×{combo}
              </div>
            )}
            {score < 10 && (
              <div className="mt-2 text-[10px] tracking-[0.35em] text-[var(--ink-faint)]">
                MOVE · TAP TO DROP · MATCH TIERS
              </div>
            )}
          </div>
          <div className="absolute right-3 top-3 z-20 flex gap-2">
            <ThemeToggle className="h-9 w-16" />
            {padConnected && (
              <div
                className="flex h-9 items-center gap-1.5 rounded border border-lime-800/60 bg-[var(--panel)] px-2.5 text-[9px] tracking-widest text-lime-400"
                title={padId || 'gamepad connected'}
              >
                <Gamepad2 className="h-3.5 w-3.5" />
                PAD
              </div>
            )}
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink)] hover:border-lime-600 hover:text-lime-400"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </div>
          <div className="pointer-events-none absolute left-3 top-4 z-10 text-[10px] tracking-[0.3em] text-[var(--ink-faint)]">
            TIER <span className="text-lime-400">{tier}</span>/11
            {best > 0 && (
              <>
                {' '}
                · BEST <span className="text-[var(--ink-dim)]">{best}</span>
              </>
            )}
          </div>
        </>
      )}

      {/* ------------------------------------------------------- MENU */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-8 backdrop-blur-[2px]">
          <div className="w-full max-w-3xl">
            <div className="text-center">
              <Link
                href="/"
                className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded border border-[var(--line-strong)] bg-[var(--panel)] px-3 py-1.5 text-[10px] tracking-[0.3em] text-[var(--ink-dim)] transition-colors hover:border-lime-600 hover:text-lime-400"
              >
                <ArrowLeft className="h-3 w-3" /> BACK TO SITE
              </Link>
              <h1 className="font-display relative inline-block select-none text-6xl tracking-tight md:text-8xl">
                <span aria-hidden className="absolute -left-1 top-0 text-lime-800/60 blur-[2px]">
                  MERGE
                </span>
                <span aria-hidden className="absolute -right-1 top-0 text-lime-300/40 blur-[2px]">
                  MERGE
                </span>
                <span className="relative text-lime-500">MERGE</span>
              </h1>
              <p className="mt-2 text-[11px] tracking-[0.35em] text-[var(--ink-dim)] md:text-xs">
                DROP · FUSE · CHAIN · FORGE THE SINGULARITY
              </p>
            </div>

            {/* stats + rules card */}
            <div className="mt-6 rounded border border-lime-900/50 bg-[var(--panel)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs tracking-widest text-[var(--ink-dim)]">
                <div className="flex items-center gap-2">
                  <Atom className="h-4 w-4 text-lime-500" /> LOCAL RECORDS
                </div>
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">
                  BEST SCORE <span className="text-lime-500">{best}</span> · BEST FORGE{' '}
                  <span className="text-lime-500">T{bestTier || '—'}</span>
                </div>
              </div>
              <div className="mt-3 grid gap-1.5 text-[11px] leading-relaxed text-[var(--ink-dim)] md:grid-cols-3">
                <div className="rounded border border-[var(--line)] bg-[var(--bg-raise)] px-2.5 py-2">
                  <span className="text-lime-600">AIM + DROP</span> — mouse, arrows or stick. Two
                  same-tier orbs that touch fuse into the next.
                </div>
                <div className="rounded border border-[var(--line)] bg-[var(--bg-raise)] px-2.5 py-2">
                  <span className="text-lime-500">CHAIN FUSIONS</span> — merges within a beat combo
                  up to ×6. Tier 11 detonates everything nearby.
                </div>
                <div className="rounded border border-[var(--line)] bg-[var(--bg-raise)] px-2.5 py-2">
                  <span className="text-red-400">MIND THE LINE</span> — rest above the danger line
                  for 3 seconds and the pit collapses.
                </div>
              </div>
              {/* fusion chain */}
              <div className="mt-3 flex items-center justify-center gap-1.5 overflow-x-auto pb-1">
                {TIER_COLORS.map((c, i) => (
                  <span
                    key={i}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-black/60"
                    style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}66` }}
                    title={`Tier ${i + 1}`}
                  >
                    {i + 1}
                  </span>
                ))}
                <span className="ml-2 shrink-0 text-[9px] tracking-widest text-[var(--ink-faint)]">
                  FUSION CHAIN
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button
                size="lg"
                className="h-14 w-64 border border-lime-500/60 bg-lime-500 text-lg font-black tracking-widest text-black shadow-[0_0_30px_rgba(163,230,53,0.3)] hover:bg-lime-400 hover:shadow-[0_0_44px_rgba(163,230,53,0.5)]"
                onClick={start}
              >
                <Play className="mr-2 h-5 w-5" />
                FEED THE PIT
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
            <div className="mt-6 rounded border border-lime-950/80 bg-[var(--panel)] p-4">
              <div className="mb-3 flex items-center justify-between text-xs tracking-widest text-[var(--ink-dim)]">
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-lime-500" /> MERGE — GLOBAL TOP 10
                </div>
                {boardMode === 'local' && (
                  <span className="text-[9px] tracking-widest text-[var(--ink-faint)]">LOCAL BOARD</span>
                )}
              </div>
              {board.length > 0 ? (
                renderBoard(board)
              ) : (
                <div className="py-4 text-center text-[11px] tracking-widest text-[var(--ink-faint)]">
                  NOTHING FORGED YET — BE THE FIRST
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
                <Crosshair className="h-4 w-4" /> PIT OVERFLOW
              </div>
              <h2 className="font-display relative mt-2 inline-block select-none text-5xl tracking-tight md:text-7xl">
                <span className="relative text-red-500">COLLAPSED</span>
              </h2>
              {newBest && (
                <div className="mt-3 inline-flex items-center gap-2 rounded border border-lime-600/50 bg-lime-950/30 px-3 py-1 text-[11px] tracking-widest text-lime-400">
                  <Zap className="h-3.5 w-3.5" /> NEW LOCAL BEST
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded border border-lime-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">SCORE</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.score}</div>
              </div>
              <div className="rounded border border-lime-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">BEST FORGE</div>
                <div className="text-xl font-black text-[var(--ink)]">T{overStats.highestTier}</div>
              </div>
              <div className="rounded border border-lime-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">FUSIONS</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.merges}</div>
              </div>
              <div className="rounded border border-lime-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-faint)]">BEST CHAIN</div>
                <div className="text-xl font-black text-[var(--ink)]">×{overStats.bestCombo}</div>
              </div>
            </div>
            {overStats.singularities > 0 && (
              <div className="mt-3 text-center text-[11px] tracking-[0.3em] text-white">
                <Atom className="mr-1.5 inline h-3.5 w-3.5" />
                {overStats.singularities} SINGULARIT{overStats.singularities > 1 ? 'IES' : 'Y'} FORGED
              </div>
            )}

            <div className="mt-4 rounded border border-lime-950/80 bg-[var(--panel)] p-4">
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
                    className="h-11 flex-1 border-lime-900/60 bg-[var(--bg-raise)] font-bold tracking-widest text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus-visible:ring-lime-500"
                    aria-label="Callsign for the leaderboard"
                  />
                  <Button
                    type="submit"
                    disabled={submitting || overStats.score <= 0}
                    className="h-11 border border-lime-500/60 bg-lime-500 font-black tracking-widest text-black hover:bg-lime-400 disabled:opacity-50"
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
                  className="h-8 border-lime-950 bg-transparent text-[11px] tracking-widest text-[var(--ink-dim)] hover:border-lime-700 hover:text-lime-400"
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
                className="h-12 w-64 border border-lime-500/60 bg-lime-500 font-black tracking-widest text-black hover:bg-lime-400"
                onClick={start}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> DROP AGAIN
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-64 border-[var(--line-strong)] bg-transparent font-bold tracking-widest text-[var(--ink-dim)] hover:border-lime-700 hover:text-lime-400"
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
            className="h-9 w-9 border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink)] hover:border-lime-600 hover:text-lime-400"
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
