'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { StackGame, type StackEvent, type StackStats } from '@/game/stack'
import { subscribeGamepads } from '@/game/gamepad'
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
import {
  ArrowLeft,
  Crosshair,
  Gamepad2,
  Layers,
  MousePointerClick,
  Play,
  RotateCcw,
  Share2,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'

type PagePhase = 'menu' | 'playing' | 'over'

export default function StackPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<StackGame | null>(null)
  const overSinceRef = useRef(0)
  const statsRef = useRef<StackStats | null>(null)

  const { toast } = useToast()

  const [phase, setPhase] = useState<PagePhase>('menu')
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [overStats, setOverStats] = useState<StackStats | null>(null)
  const [muted, setMuted] = useState(false)
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [boardMode, setBoardMode] = useState<'online' | 'local'>('online')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [rank, setRank] = useState<number | null>(null)
  const [best, setBest] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [newBest, setNewBest] = useState(false)
  const [padConnected, setPadConnected] = useState(false)
  const [padId, setPadId] = useState('')

  // gamepad start/retry reads the live phase through a ref (callback is bound once)
  const phaseRef = useRef<PagePhase>('menu')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const applyBoard = useCallback((res: BoardResult) => {
    setBoard(res.scores)
    setBoardMode(res.mode)
  }, [])

  const refreshBoard = useCallback(async () => {
    applyBoard(await fetchBoard('stack'))
  }, [applyBoard])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = new StackGame(canvas, (ev: StackEvent) => {
      if (ev.type === 'drop') {
        setScore(ev.score)
        setStreak(ev.streak)
      } else if (ev.type === 'phase') {
        if (ev.phase === 'playing') {
          setPhase('playing')
          setScore(0)
          setStreak(0)
          setNewBest(false)
        } else if (ev.phase === 'over') {
          // let the crumble animation breathe before the overlay lands
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
                  window.localStorage.setItem('brutal.stack.best', String(stats.score))
                } catch {
                  // storage unavailable
                }
                return stats.score
              }
              return prev
            })
            setBestStreak((prev) => {
              const next = Math.max(prev, stats.bestStreak)
              try {
                window.localStorage.setItem('brutal.stack.beststreak', String(next))
              } catch {
                // ignore
              }
              return next
            })
          }, 600)
        }
      } else if (ev.type === 'gameover') {
        statsRef.current = ev.stats
      } else if (ev.type === 'padstart') {
        // gamepad A / Start on the menu or game-over overlay
        if (phaseRef.current === 'menu') {
          engineRef.current?.start()
        } else if (phaseRef.current === 'over' && performance.now() - overSinceRef.current > 450) {
          engineRef.current?.start()
        }
      }
    })
    engineRef.current = engine
    setName(recallPlayerName())
    try {
      const b = Number(window.localStorage.getItem('brutal.stack.best'))
      if (Number.isFinite(b) && b > 0) setBest(b)
      const s = Number(window.localStorage.getItem('brutal.stack.beststreak'))
      if (Number.isFinite(s) && s > 0) setBestStreak(s)
    } catch {
      // storage unavailable
    }
    void refreshBoard()
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [refreshBoard])

  // gamepad link badge — fires on connect/disconnect (Chrome needs one button press)
  useEffect(() => {
    return subscribeGamepads((connected, id) => {
      setPadConnected(connected)
      setPadId(id)
    })
  }, [])

  const start = useCallback(() => {
    engineRef.current?.start()
  }, [])

  // space: start / instant retry — the hyper-casual loop
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
      } else if (phase === 'over' && performance.now() - overSinceRef.current > 450) {
        e.preventDefault()
        start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, start])

  const retry = useCallback(() => {
    if (performance.now() - overSinceRef.current > 350) start()
  }, [start])

  const submit = async () => {
    const stats = overStats
    if (!stats || submitted || submitting) return
    if (stats.score <= 0) return
    const n = (name.trim() || 'ANON').slice(0, 16).toUpperCase()
    setSubmitting(true)
    try {
      const res = await submitScore('stack', {
        name: n,
        score: stats.score,
        wave: stats.score, // height for the stack board
        kills: stats.perfects, // perfect drops
      })
      setSubmitted(true)
      setRank(res.rank)
      setBoard(res.board)
      setBoardMode(res.mode)
      rememberPlayerName(n)
    } catch {
      // user can retry
    } finally {
      setSubmitting(false)
    }
  }

  const shareScore = async () => {
    if (!overStats) return
    const url = `${window.location.origin}/stack`
    const text = `I stacked ${overStats.score} blocks (${overStats.perfects} perfect drops, best streak ×${overStats.bestStreak}) in BRUTAL//STACK. Beat that. ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BRUTAL//STACK', text })
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
          <tr key={e.id} className="border-b border-red-950/40 last:border-0">
            <td className="py-1.5 pr-2 text-stone-600">{String(i + 1).padStart(2, '0')}</td>
            <td className="py-1.5 pr-2 font-bold text-stone-200">{e.name}</td>
            <td className="py-1.5 text-right text-amber-500">{e.score}</td>
            <td className="py-1.5 pl-3 text-right text-stone-500">{e.wave} ALT</td>
            <td className="py-1.5 pl-3 text-right text-stone-500">{e.kills} P</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <main className="relative h-dvh w-full select-none overflow-hidden bg-[#070709] font-mono text-stone-200">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none"
        aria-label="BRUTAL stack — game viewport"
      />

      {/* ------------------------------------------------- IN-PLAY HUD */}
      {phase === 'playing' && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 text-center">
            <div className="text-5xl font-black tabular-nums tracking-tighter text-stone-100 md:text-6xl">
              {String(score).padStart(3, '0')}
            </div>
            {streak >= 2 && (
              <div className="mt-1 text-xs font-black tracking-[0.3em] text-amber-400">
                PERFECT ×{streak}
              </div>
            )}
            {score < 2 && (
              <div className="mt-2 text-[10px] tracking-[0.35em] text-stone-500">
                TAP / SPACE / PAD — DROP
              </div>
            )}
          </div>
          <div className="absolute right-3 top-3 z-20 flex gap-2">
            {padConnected && (
              <div
                className="flex h-9 items-center gap-1.5 rounded border border-amber-800/60 bg-black/50 px-2.5 text-[9px] tracking-widest text-amber-400"
                title={padId || 'gamepad connected'}
              >
                <Gamepad2 className="h-3.5 w-3.5" />
                PAD
              </div>
            )}
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 border-red-900/60 bg-black/50 text-stone-300 hover:bg-red-950/60 hover:text-red-400"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </div>
          {best > 0 && (
            <div className="pointer-events-none absolute left-3 top-4 z-10 text-[10px] tracking-[0.3em] text-stone-600">
              BEST <span className="text-stone-400">{best}</span>
            </div>
          )}
        </>
      )}

      {/* ------------------------------------------------------- MENU */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-black/70 via-black/50 to-black/80 px-4 py-8">
          <div className="w-full max-w-3xl">
            <div className="text-center">
              <Link
                href="/"
                className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded border border-stone-800/80 bg-black/70 px-3 py-1.5 text-[10px] tracking-[0.3em] text-stone-400 transition-colors hover:border-red-800 hover:text-red-400"
              >
                <ArrowLeft className="h-3 w-3" /> BACK TO SITE
              </Link>
              <h1 className="relative inline-block select-none text-6xl font-black tracking-tighter md:text-8xl">
                <span aria-hidden className="absolute -left-1 top-0 text-red-700/50 blur-[2px]">
                  STACK
                </span>
                <span aria-hidden className="absolute -right-1 top-0 text-amber-500/40 blur-[2px]">
                  STACK
                </span>
                <span className="relative text-red-500">STACK</span>
              </h1>
              <p className="mt-2 text-[11px] tracking-[0.35em] text-stone-400 md:text-xs">
                ONE TAP · STACK IT PERFECT · GROW IT BACK
              </p>
            </div>

            {/* stats + rules card */}
            <div className="mt-6 rounded border border-amber-900/50 bg-black/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs tracking-widest text-stone-400">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" /> LOCAL RECORDS
                </div>
                <div className="text-[10px] tracking-widest text-stone-500">
                  BEST HEIGHT <span className="text-amber-400">{best}</span> · BEST STREAK{' '}
                  <span className="text-amber-400">×{bestStreak}</span>
                </div>
              </div>
              <div className="mt-3 grid gap-1.5 text-[11px] leading-relaxed text-stone-400 md:grid-cols-3">
                <div className="rounded border border-stone-800 bg-black/50 px-2.5 py-2">
                  <span className="text-red-400">TAP / SPACE / PAD BUTTON</span> — drop the block.
                  The overhang gets sliced off.
                </div>
                <div className="rounded border border-stone-800 bg-black/50 px-2.5 py-2">
                  <span className="text-amber-400">PERFECT DROPS</span> — stack 3+ in a row and the
                  tower regrows wider.
                </div>
                <div className="rounded border border-stone-800 bg-black/50 px-2.5 py-2">
                  <span className="text-red-400">MISS THE TOWER</span> — run over. Tap to restart
                  instantly.
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button
                size="lg"
                className="h-14 w-64 border border-red-500/60 bg-red-600 text-lg font-black tracking-widest text-white shadow-[0_0_30px_rgba(239,68,68,0.35)] hover:bg-red-500 hover:shadow-[0_0_44px_rgba(239,68,68,0.55)]"
                onClick={start}
              >
                <Play className="mr-2 h-5 w-5" />
                START STACKING
              </Button>
              <Link
                href="/play"
                className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.25em] text-stone-500 transition-colors hover:text-red-400"
              >
                <Swords className="h-3.5 w-3.5" /> PREFER GUNS? ENTER THE ARENA
              </Link>
            </div>

            {/* leaderboard */}
            <div className="mt-6 rounded border border-red-950/80 bg-black/60 p-4">
              <div className="mb-3 flex items-center justify-between text-xs tracking-widest text-stone-400">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-red-500" /> STACK — GLOBAL TOP 10
                </div>
                {boardMode === 'local' && (
                  <span className="text-[9px] tracking-widest text-stone-600">LOCAL BOARD</span>
                )}
              </div>
              {board.length > 0 ? (
                renderBoard(board)
              ) : (
                <div className="py-4 text-center text-[11px] tracking-widest text-stone-600">
                  NO TOWERS LOGGED YET — BE THE FIRST
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- GAME OVER */}
      {phase === 'over' && overStats && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-[1px]"
          onClick={retry}
        >
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-xs tracking-[0.4em] text-red-600">
                <Crosshair className="h-4 w-4" /> TOWER DOWN
              </div>
              <h2 className="relative mt-2 inline-block select-none text-5xl font-black tracking-tighter md:text-7xl">
                <span aria-hidden className="absolute -left-1 top-0 text-red-800/50 blur-[2px]">
                  COLLAPSED
                </span>
                <span className="relative text-red-500">COLLAPSED</span>
              </h2>
              {newBest && (
                <div className="mt-3 inline-flex items-center gap-2 rounded border border-amber-600/50 bg-amber-950/30 px-3 py-1 text-[11px] tracking-widest text-amber-400">
                  <Zap className="h-3.5 w-3.5" /> NEW LOCAL BEST
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded border border-red-950/80 bg-black/60 p-3 text-center">
                <div className="text-[10px] tracking-widest text-stone-500">HEIGHT</div>
                <div className="text-xl font-black text-stone-100">{overStats.score}</div>
              </div>
              <div className="rounded border border-red-950/80 bg-black/60 p-3 text-center">
                <div className="text-[10px] tracking-widest text-stone-500">PERFECTS</div>
                <div className="text-xl font-black text-stone-100">{overStats.perfects}</div>
              </div>
              <div className="rounded border border-red-950/80 bg-black/60 p-3 text-center">
                <div className="text-[10px] tracking-widest text-stone-500">BEST STREAK</div>
                <div className="text-xl font-black text-stone-100">×{overStats.bestStreak}</div>
              </div>
            </div>

            <div className="mt-4 rounded border border-red-950/80 bg-black/60 p-4">
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
                    className="h-11 flex-1 border-red-900/60 bg-black/60 font-bold tracking-widest text-stone-100 placeholder:text-stone-700 focus-visible:ring-red-500"
                    aria-label="Callsign for the leaderboard"
                  />
                  <Button
                    type="submit"
                    disabled={submitting || overStats.score <= 0}
                    className="h-11 border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500 disabled:opacity-50"
                  >
                    {submitting ? 'TRANSMITTING…' : 'SUBMIT SCORE'}
                  </Button>
                </form>
              ) : (
                <div className="py-1 text-center text-sm tracking-widest text-emerald-400">
                  SCORE LOGGED{rank ? ` — GLOBAL RANK #${rank}` : ''}
                  {boardMode === 'local' && (
                    <span className="ml-2 text-[10px] text-stone-500">(LOCAL BOARD)</span>
                  )}
                </div>
              )}
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-red-950 bg-transparent text-[11px] tracking-widest text-stone-400 hover:border-red-800 hover:text-stone-200"
                  onClick={() => void shareScore()}
                >
                  <Share2 className="mr-1.5 h-3.5 w-3.5" /> SHARE THIS RUN
                </Button>
              </div>
              <ScrollArea className="mt-4 max-h-48">
                {board.length > 0 && renderBoard(board)}
              </ScrollArea>
            </div>

            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-12 w-64 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500"
                onClick={start}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> STACK AGAIN
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-64 border-red-950 bg-transparent font-bold tracking-widest text-stone-400 hover:border-red-800 hover:text-stone-200"
                onClick={() => {
                  setPhase('menu')
                  void refreshBoard()
                }}
              >
                MAIN MENU
              </Button>
            </div>
            <div className="mt-4 text-center">
              <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-600">
                <MousePointerClick className="h-3.5 w-3.5" /> TAP ANYWHERE — INSTANT RETRY
              </span>
            </div>
          </div>
        </div>
      )}

      {/* mute button on menu too */}
      {phase === 'menu' && (
        <div className="absolute right-3 top-3 z-20">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 border-red-900/60 bg-black/50 text-stone-300 hover:bg-red-950/60 hover:text-red-400"
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
