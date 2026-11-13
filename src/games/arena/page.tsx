'use client'

// BRUTAL//ARENA runner — the full game experience (canvas + menus + boards),
// hosted by the portal GameStage at /games/arena. The ENGINE lives untouched
// in src/game/engine.ts; this runner mounts it through the kit shim.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { GameEvent, GamePhase, RunStats, UpgradeDef } from '@/game/types'
import { createGame } from './shim'
import { buildCtx, destroyCtx } from '@/game-kit'
import type { EngineHandle } from '../wrap-engine'
import type { StageProps } from '../runner-types'
import {
  ACHIEVEMENTS,
  emptyPilot,
  levelFromXp,
  loadPilot,
  savePilot,
  type PilotData,
} from '@/game/pilot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useTheme } from '@/lib/theme'
import { useToast } from '@/hooks/use-toast'
import { subscribeGamepads } from '@/game/gamepad'
import {
  fetchBoard as fetchBoardApi,
  recallPlayerName,
  rememberPlayerName,
  submitScore as submitScoreApi,
  type BoardEntry,
} from '@/lib/scores-client'
import { beginRun, endRun } from '@/lib/run-session-client'
import { RankAuthHint } from '@/components/portal/RankAuthHint'
import {
  ArrowLeft,
  Crosshair,
  Gamepad2,
  Home as HomeIcon,
  Keyboard,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Skull,
  Layers,
  Smartphone,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function ArenaRunner({ stage }: { stage?: StageProps }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<EngineHandle<import('@/game/engine').BrutalGame> | null>(null)
  const pilotRef = useRef<PilotData>(loadPilot())
  const unlockedThisRunRef = useRef<Set<string>>(new Set())

  const { toast } = useToast()
  const { theme } = useTheme()
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  const [phase, setPhase] = useState<GamePhase>('menu')
  const [choices, setChoices] = useState<UpgradeDef[]>([])
  const [overStats, setOverStats] = useState<RunStats | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const runActiveRef = useRef(false)
  const [muted, setMuted] = useState(false)
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [rank, setRank] = useState<number | null>(null)
  const [best, setBest] = useState(0)
  const [newBest, setNewBest] = useState(false)
  const [pilot, setPilot] = useState<PilotData>(() => emptyPilot())
  const [xpGain, setXpGain] = useState(0)
  const [unlockedThisRun, setUnlockedThisRun] = useState<string[]>([])
  const [padConnected, setPadConnected] = useState(false)
  const [padId, setPadId] = useState('')

  const unlockAchievement = useCallback(
    (id: string) => {
      const def = ACHIEVEMENTS.find((a) => a.id === id)
      if (!def) return
      if (pilotRef.current.achievements.includes(id)) return
      pilotRef.current.achievements.push(id)
      savePilot(pilotRef.current)
      if (!unlockedThisRunRef.current.has(id)) {
        unlockedThisRunRef.current.add(id)
        setUnlockedThisRun([...unlockedThisRunRef.current])
      }
      setPilot({ ...pilotRef.current })
      toast({
        title: `ACHIEVEMENT — ${def.name}`,
        description: def.desc,
      })
    },
    [toast],
  )

  const fetchBoard = useCallback(async () => {
    // online board first; falls back to a local board on static deployments
    const res = await fetchBoardApi('arena')
    setBoard(res.scores)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleEvent = (ev: GameEvent) => {
      if (ev.type === 'phase') {
        setPhase(ev.phase)
      } else if (ev.type === 'choices') {
        setChoices(ev.choices)
      } else if (ev.type === 'milestone') {
        if (ev.kind === 'combo' && ev.value >= 25) unlockAchievement('combo25')
        if (ev.kind === 'boss' && ev.value >= 1) unlockAchievement('boss')
        if (ev.kind === 'overdrive' && ev.value >= 1) unlockAchievement('od')
        if (ev.kind === 'elite' && ev.value >= 10) unlockAchievement('elite10')
      } else if (ev.type === 'gameover') {
        const stats = ev.stats
        setOverStats(stats)
        setSubmitted(false)
        setRank(null)
        unlockedThisRunRef.current = new Set()
        setUnlockedThisRun([])
        // progression
        const gained = Math.max(10, Math.round(stats.score / 10))
        setXpGain(gained)
        const p = pilotRef.current
        p.xp += gained
        p.totalKills += stats.kills
        p.runs += 1
        p.timePlayed += stats.timeAlive
        p.bestCombo = Math.max(p.bestCombo, stats.maxCombo)
        savePilot(p)
        setPilot({ ...p })
        // run achievements
        if (stats.kills >= 1) unlockAchievement('first_blood')
        if (stats.wave >= 5) unlockAchievement('wave5')
        if (stats.wave >= 10) unlockAchievement('wave10')
        if (stats.timeAlive >= 300) unlockAchievement('survivor')
        if (stats.score >= 10_000) unlockAchievement('score10k')
        setBest((prev) => {
          if (stats.score > prev) {
            setNewBest(true)
            try {
              window.localStorage.setItem('brutal.best', String(stats.score))
            } catch {
              // storage unavailable — no big deal
            }
            return stats.score
          }
          setNewBest(false)
          return prev
        })
      } else if (ev.type === 'padstart') {
        // gamepad A / Start on the menu overlay — mirrors the START RUN button
        engineRef.current?.engine.unlockAudio()
        engineRef.current?.engine.startRun()
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
        onGameOver: (s) => stage?.onRunEnd?.(s),
        onGameEvent: (ev) => handleEvent(ev as GameEvent),
      },
    })
    const handle = createGame(ctx)
    engineRef.current = handle
    handle.setTheme(theme)
    stage?.onReady?.()
    // hydrate pilot AFTER mount to avoid SSR/client mismatch
    setPilot({ ...pilotRef.current })
    try {
      setName(recallPlayerName())
      const storedBest = window.localStorage.getItem('brutal.best')
      if (storedBest) setBest(Number(storedBest) || 0)
    } catch {
      // storage unavailable
    }
    void fetchBoard()
    // deep-link: /games/arena?wave=5 starts a boss-rush run at wave 5
    const params = new URLSearchParams(window.location.search)
    const waveParam = Number(params.get('wave'))
    if (Number.isFinite(waveParam) && waveParam >= 1 && waveParam <= 99) {
      handle.engine.startRun(Math.floor(waveParam))
    }
    return () => {
      handle.destroy()
      destroyCtx(ctx)
      engineRef.current = null
    }
  }, [fetchBoard, unlockAchievement, stage?.daily])

  // gamepad link badge — fires on connect/disconnect (Chrome needs one button press)
  useEffect(() => {
    return subscribeGamepads((connected, id) => {
      setPadConnected(connected)
      setPadId(id)
    })
  }, [])

  // live NIGHT/DAY switch — engine re-renders with the new palette next frame
  useEffect(() => {
    engineRef.current?.setTheme(theme)
  }, [theme])

  // run-session lifecycle: fresh session when a run starts (not on resume)
  useEffect(() => {
    if (phase === 'playing' && !runActiveRef.current) {
      runActiveRef.current = true
      endRun()
      void beginRun('arena', stage?.daily ? { seed: stage.daily.seed } : undefined)
    }
    if (phase === 'gameover' || phase === 'menu') {
      runActiveRef.current = false
    }
  }, [phase])

  const start = () => {
    engineRef.current?.engine.unlockAudio()
    engineRef.current?.engine.startRun()
  }

  const submitScore = async () => {
    if (!overStats || submitted || submitting) return
    const n = (name.trim() || 'ANON').slice(0, 16).toUpperCase()
    setSubmitting(true)
    try {
      const res = await submitScoreApi('arena', {
        name: n,
        score: overStats.score,
        wave: overStats.wave,
        kills: overStats.kills,
      })
      setSubmitted(true)
      setRank(res.rank)
      setBoard(res.board)
      setNeedsAuth(Boolean(res.authRequired))
      unlockAchievement('ranked')
      rememberPlayerName(n)
    } catch {
      // ignore — user can retry
    } finally {
      setSubmitting(false)
    }
  }

  const shareScore = async () => {
    if (!overStats) return
    const url = `${window.location.origin}/games/arena`
    const text = `I scored ${overStats.score.toLocaleString()} pts (wave ${overStats.wave}, ${overStats.kills} kills) in BRUTAL//ARENA. Think you can beat me? ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BRUTAL//ARENA', text })
        return
      }
    } catch {
      // user cancelled or share failed — fall through to clipboard
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

  const lvl = levelFromXp(pilot.xp)
  const achCount = pilot.achievements.length
  const showCornerControls = phase !== 'menu'

  return (
    <main className="relative h-full w-full select-none overflow-hidden bg-[var(--bg)] font-mono text-[var(--ink)]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none"
        aria-label="BRUTAL arena — game viewport"
      />

      {/* corner controls */}
      {showCornerControls && (
        <div className="absolute right-3 top-3 z-20 flex gap-2">
          <ThemeToggle className="h-9 w-16" />
          {padConnected && (
            <div
              className="flex h-9 items-center gap-1.5 rounded border border-amber-800/60 bg-[var(--panel)] px-2.5 text-[9px] tracking-widest text-amber-400"
              title={padId || 'gamepad connected'}
            >
              <Gamepad2 className="h-3.5 w-3.5" />
              PAD
            </div>
          )}
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 border-red-900/60 bg-[var(--panel)] text-[var(--ink-dim)] hover:bg-red-950/60 hover:text-red-400"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          {phase === 'playing' && (
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 border-red-900/60 bg-[var(--panel)] text-[var(--ink-dim)] hover:bg-red-950/60 hover:text-red-400"
              onClick={() => engineRef.current?.engine.togglePause()}
              aria-label="Pause"
            >
              <Pause className="h-4 w-4" />
            </Button>
          )}
          {(phase === 'paused' || phase === 'gameover') && (
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 border-red-900/60 bg-[var(--panel)] text-[var(--ink-dim)] hover:bg-red-950/60 hover:text-red-400"
              onClick={() => engineRef.current?.engine.quitToMenu()}
              aria-label="Back to menu"
            >
              <HomeIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- MENU */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-8">
          <div className="w-full max-w-3xl">
            <div className="text-center">
              <Link
                href="/"
                className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded border border-[var(--line-strong)] bg-[var(--overlay)] px-3 py-1.5 text-[10px] tracking-[0.3em] text-[var(--ink-dim)] transition-colors hover:border-red-800 hover:text-red-400"
              >
                <ArrowLeft className="h-3 w-3" /> BACK TO SITE
              </Link>
              <h1 className="relative inline-block select-none text-6xl font-black tracking-tighter md:text-8xl">
                <span
                  aria-hidden
                  className="absolute -left-1 top-0 text-red-700/50 blur-[2px]"
                >
                  BRUTAL
                </span>
                <span
                  aria-hidden
                  className="absolute -right-1 top-0 text-amber-500/40 blur-[2px]"
                >
                  BRUTAL
                </span>
                <span className="relative text-red-500">BRUTAL</span>
              </h1>
              <p className="mt-2 text-[11px] tracking-[0.35em] text-[var(--ink-dim)] md:text-xs">
                SURVIVE THE WAVES · DRAFT UPGRADES · KILL THE BRUTE
              </p>
            </div>

            {/* pilot card */}
            <div className="mt-6 rounded border border-amber-900/50 bg-[var(--panel)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs tracking-widest text-[var(--ink-dim)]">
                  <Trophy className="h-4 w-4 text-amber-500" /> PILOT LEVEL{' '}
                  <span className="text-lg font-black text-amber-400">{lvl.level}</span>
                </div>
                <div className="text-[10px] tracking-widest text-[var(--ink-dim)]">
                  {pilot.runs} RUNS · {pilot.totalKills.toLocaleString()} KILLS ·{' '}
                  {achCount}/{ACHIEVEMENTS.length} ACHIEVEMENTS
                </div>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-sm bg-[var(--line)]">
                <div
                  className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all"
                  style={{ width: `${Math.min(100, (lvl.into / lvl.need) * 100)}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] tracking-widest text-[var(--ink-dim)]">
                <span>
                  {lvl.into} / {lvl.need} XP
                </span>
                <span>SCORE = XP — DIE LOUD, RANK UP</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5 md:grid-cols-5">
                {ACHIEVEMENTS.map((a) => {
                  const got = pilot.achievements.includes(a.id)
                  return (
                    <div
                      key={a.id}
                      title={a.desc}
                      className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[9px] tracking-wider ${
                        got
                          ? 'border-amber-800/60 bg-amber-950/30 text-amber-400'
                          : 'border-[var(--line)] bg-[var(--panel)] text-[var(--ink-dim)]'
                      }`}
                    >
                      {got ? <Zap className="h-3 w-3 shrink-0" /> : <Lock className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{a.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button
                size="lg"
                className="h-14 w-64 border border-red-500/60 bg-red-600 text-lg font-black tracking-widest text-white shadow-[0_0_30px_rgba(239,68,68,0.35)] hover:bg-red-500 hover:shadow-[0_0_44px_rgba(239,68,68,0.55)]"
                onClick={start}
              >
                <Play className="mr-2 h-5 w-5" />
                START RUN
              </Button>
              {best > 0 && (
                <div className="text-xs tracking-widest text-[var(--ink-dim)]">
                  LOCAL BEST <span className="text-amber-500">{String(best).padStart(6, '0')}</span>
                </div>
              )}
              <Link
                href="/games/stack"
                className="inline-flex items-center gap-1.5 pt-1 text-[11px] tracking-[0.25em] text-[var(--ink-dim)] transition-colors hover:text-red-400"
              >
                <Layers className="h-3.5 w-3.5" /> NEW — ONE-TAP TOWER: BRUTAL//STACK
              </Link>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs tracking-widest text-[var(--ink-dim)]">
                  <Keyboard className="h-4 w-4 text-red-500" /> KEYBOARD + MOUSE
                </div>
                <ul className="space-y-1.5 text-xs text-[var(--ink-dim)]">
                  <li>
                    <span className="text-red-400">WASD / ARROWS</span> — move
                  </li>
                  <li>
                    <span className="text-red-400">MOUSE</span> — aim ·{' '}
                    <span className="text-red-400">HOLD LMB</span> — fire
                  </li>
                  <li>
                    <span className="text-red-400">SPACE / SHIFT</span> — dash (i-frames)
                  </li>
                  <li>
                    <span className="text-amber-400">E</span> — overdrive (when meter is full)
                  </li>
                  <li>
                    <span className="text-red-400">ESC / P</span> — pause ·{' '}
                    <span className="text-red-400">R</span> — quick restart
                  </li>
                </ul>
              </div>
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs tracking-widest text-[var(--ink-dim)]">
                  <Smartphone className="h-4 w-4 text-red-500" /> TOUCH
                </div>
                <ul className="space-y-1.5 text-xs text-[var(--ink-dim)]">
                  <li>
                    <span className="text-red-400">LEFT THUMB</span> — virtual stick to move
                  </li>
                  <li>
                    <span className="text-red-400">RIGHT THUMB</span> — aim &amp; fire stick
                  </li>
                  <li>
                    <span className="text-amber-400">ULT BUTTON</span> — overdrive when charged
                  </li>
                  <li>Move-only? Auto-aim fires for you</li>
                  <li>Pick upgrades between waves — 1 / 2 / 3 keys</li>
                </ul>
              </div>
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs tracking-widest text-[var(--ink-dim)]">
                    <Gamepad2 className="h-4 w-4 text-red-500" /> GAMEPAD
                  </div>
                  <span
                    className={`text-[9px] tracking-widest ${
                      padConnected ? 'text-emerald-400' : 'text-[var(--ink-faint)]'
                    }`}
                    title={padConnected ? padId : 'plug in a pad and press any button'}
                  >
                    {padConnected ? 'LINKED' : 'PRESS ANY BUTTON'}
                  </span>
                </div>
                <ul className="space-y-1.5 text-xs text-[var(--ink-dim)]">
                  <li>
                    <span className="text-red-400">LEFT STICK / D-PAD</span> — move
                  </li>
                  <li>
                    <span className="text-red-400">RIGHT STICK</span> — aim ·{' '}
                    <span className="text-red-400">RT / R2 / A</span> — fire
                  </li>
                  <li>
                    <span className="text-red-400">B / LB</span> — dash ·{' '}
                    <span className="text-amber-400">Y / TRIANGLE</span> — overdrive
                  </li>
                  <li>
                    <span className="text-red-400">START</span> — pause ·{' '}
                    <span className="text-red-400">A</span> — restart / confirm
                  </li>
                  <li>Pick upgrades — A / X / Y</li>
                  <li>Move-only? Auto-aim tracks, trigger fires</li>
                </ul>
              </div>
            </div>

            <p className="mt-6 text-center text-[10px] leading-relaxed tracking-wider text-[var(--ink-dim)]">
              A fan-made arena shooter tribute to{' '}
              <span className="text-[var(--ink-dim)]">BRUTAL</span>, the open-source C# game
              framework by ahwoo (github.com/ahwootech/BRUTAL). Not affiliated — just
              respect.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- UPGRADE */}
      {phase === 'upgrade' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-8 backdrop-blur-[2px]">
          <div className="w-full max-w-4xl">
            <div className="mb-6 text-center">
              <div className="flex items-center justify-center gap-2 text-xs tracking-[0.4em] text-red-500">
                <Skull className="h-4 w-4" /> WAVE CLEARED
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)] md:text-4xl">
                CHOOSE YOUR UPGRADE
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {choices.map((c, i) => (
                <button
                  key={c.id}
                  className="group relative rounded border border-red-950/80 bg-[var(--overlay)] p-5 text-left transition-all hover:-translate-y-1 hover:border-red-500/80 hover:bg-red-950/30 hover:shadow-[0_0_30px_rgba(239,68,68,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  onClick={() => engineRef.current?.engine.pickUpgrade(c.id)}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className={
                        c.tag === 'OFFENSE'
                          ? 'border-red-800/70 bg-red-950/40 text-red-400'
                          : c.tag === 'DEFENSE'
                            ? 'border-emerald-900/70 bg-emerald-950/40 text-emerald-400'
                            : c.tag === 'MOBILITY'
                              ? 'border-amber-900/70 bg-amber-950/40 text-amber-400'
                              : 'border-fuchsia-900/70 bg-fuchsia-950/40 text-fuchsia-400'
                      }
                    >
                      {c.tag}
                    </Badge>
                    <span className="text-[10px] tracking-widest text-[var(--ink-faint)] group-hover:text-[var(--ink-dim)]">
                      [{i + 1}]
                    </span>
                  </div>
                  <div className="text-sm font-black tracking-wide text-[var(--ink)] group-hover:text-white">
                    {c.name}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--ink-dim)]">{c.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- PAUSED */}
      {phase === 'paused' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-[2px]">
          <div className="text-center">
            <h2 className="text-4xl font-black tracking-[0.3em] text-[var(--ink)]">PAUSED</h2>
            <p className="mt-2 text-xs tracking-widest text-[var(--ink-dim)]">
              THE ARENA WAITS FOR NO ONE
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <Button
                size="lg"
                className="h-12 w-64 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500"
                onClick={() => engineRef.current?.engine.togglePause()}
              >
                RESUME
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-10 w-64 border-red-950 bg-transparent text-[var(--ink-dim)] hover:border-red-800 hover:text-[var(--ink)]"
                onClick={() => engineRef.current?.engine.quitToMenu()}
              >
                ABANDON RUN
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ GAME OVER */}
      {phase === 'gameover' && overStats && (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-8 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-xs tracking-[0.4em] text-red-600">
                <Crosshair className="h-4 w-4" /> SIGNAL LOST
              </div>
              <h2 className="relative mt-2 inline-block select-none text-5xl font-black tracking-tighter md:text-7xl">
                <span aria-hidden className="absolute -left-1 top-0 text-red-800/50 blur-[2px]">
                  TERMINATED
                </span>
                <span className="relative text-red-500">TERMINATED</span>
              </h2>
              {newBest && (
                <div className="mt-3 inline-flex items-center gap-2 rounded border border-amber-600/50 bg-amber-950/30 px-3 py-1 text-[11px] tracking-widest text-amber-400">
                  <Zap className="h-3.5 w-3.5" /> NEW LOCAL BEST
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-dim)]">SCORE</div>
                <div className="text-xl font-black text-[var(--ink)]">
                  {String(overStats.score).padStart(6, '0')}
                </div>
              </div>
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-dim)]">WAVE</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.wave}</div>
              </div>
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="text-[10px] tracking-widest text-[var(--ink-dim)]">KILLS</div>
                <div className="text-xl font-black text-[var(--ink)]">{overStats.kills}</div>
              </div>
              <div className="rounded border border-red-950/80 bg-[var(--panel)] p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-[10px] tracking-widest text-[var(--ink-dim)]">
                  <Timer className="h-3 w-3" /> TIME
                </div>
                <div className="text-xl font-black text-[var(--ink)]">
                  {fmtTime(overStats.timeAlive)}
                </div>
              </div>
            </div>

            {/* xp gain */}
            <div className="mt-3 rounded border border-amber-900/50 bg-[var(--panel)] p-4">
              <div className="mb-2 flex items-center justify-between text-[11px] tracking-widest">
                <span className="text-amber-400">
                  +{xpGain} XP — PILOT LEVEL {lvl.level}
                </span>
                <span className="text-[var(--ink-dim)]">
                  {lvl.into} / {lvl.need} XP TO LEVEL {lvl.level + 1}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-sm bg-[var(--line)]">
                <div
                  className="h-full bg-gradient-to-r from-amber-600 to-amber-400"
                  style={{ width: `${Math.min(100, (lvl.into / lvl.need) * 100)}%` }}
                />
              </div>
              {unlockedThisRun.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {unlockedThisRun.map((id) => {
                    const a = ACHIEVEMENTS.find((x) => x.id === id)
                    if (!a) return null
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[9px] tracking-widest text-amber-400"
                      >
                        <Zap className="h-3 w-3" /> {a.name}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 rounded border border-red-950/80 bg-[var(--panel)] p-4">
              {!submitted ? (
                <form
                  className="flex flex-col gap-3 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submitScore()
                  }}
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 16))}
                    placeholder="CALLSIGN"
                    maxLength={16}
                    className="h-11 flex-1 border-red-900/60 bg-[var(--panel)] font-bold tracking-widest text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus-visible:ring-red-500"
                    aria-label="Callsign for the leaderboard"
                  />
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="h-11 border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500 disabled:opacity-50"
                  >
                    {submitting ? 'TRANSMITTING…' : 'SUBMIT SCORE'}
                  </Button>
                </form>
              ) : (
                <div className="py-1 text-center text-sm tracking-widest text-emerald-400">
                  SCORE LOGGED{rank ? ` — GLOBAL RANK #${rank}` : ''}
                </div>
              )}
              {needsAuth && <RankAuthHint />}
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-red-950 bg-transparent text-[11px] tracking-widest text-[var(--ink-dim)] hover:border-red-800 hover:text-[var(--ink)]"
                  onClick={() => void shareScore()}
                >
                  <Share2 className="mr-1.5 h-3.5 w-3.5" /> SHARE THIS RUN
                </Button>
              </div>
              <ScrollArea className="mt-4 max-h-48">
                {board.length > 0 && (
                  <table className="w-full text-xs">
                    <tbody>
                      {board.map((e, i) => (
                        <tr key={e.id} className="border-b border-red-950/40 last:border-0">
                          <td className="py-1.5 pr-2 text-[var(--ink-faint)]">
                            {String(i + 1).padStart(2, '0')}
                          </td>
                          <td className="py-1.5 pr-2 font-bold text-[var(--ink)]">{e.name}</td>
                          <td className="py-1.5 text-right text-amber-500">
                            {String(e.score).padStart(6, '0')}
                          </td>
                          <td className="py-1.5 pl-3 text-right text-[var(--ink-dim)]">W{e.wave}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ScrollArea>
            </div>

            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-12 w-64 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500"
                onClick={start}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> RUN IT BACK
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-64 border-red-950 bg-transparent font-bold tracking-widest text-[var(--ink-dim)] hover:border-red-800 hover:text-[var(--ink)]"
                onClick={() => engineRef.current?.engine.quitToMenu()}
              >
                MAIN MENU
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
