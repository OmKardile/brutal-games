'use client'

// Rewards HUD for the play page. Completely passive for gameplay:
// - counts real input events (keydown/pointer) on the window
// - uses the SHARED run-session token (run-session-client) — the game page
//   opens the session at run start; no separate rewards session since 0.8
// - sends a heartbeat every interval while playing (tab visible + input = active)
// - sends run stats at gameover for run-completion + daily-challenge points
// Renders a small chip top-left; renders nothing when rewards are disabled.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { GamePhase, RunStats } from '@/game/types'
import { useToast } from '@/hooks/use-toast'
import { subscribeRunToken } from '@/lib/run-session-client'
import { Coins } from 'lucide-react'

interface Props {
  phase: GamePhase
  lastStats: RunStats | null
}

interface HeartbeatResponse {
  ok: boolean
  points?: number
  todayEarned?: number
  todayCap?: number
  active?: boolean
}

export function RewardsHud({ phase, lastStats }: Props) {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [today, setToday] = useState<{ earned: number; cap: number } | null>(null)
  const tokenRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputCountRef = useRef(0)
  const lastStatsRef = useRef<RunStats | null>(null)

  lastStatsRef.current = lastStats

  // read config + session once
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [cfgRes, meRes] = await Promise.all([
          fetch('/api/rewards/config', { cache: 'no-store' }),
          fetch('/api/auth/me', { cache: 'no-store' }),
        ])
        const cfg = cfgRes.ok ? await cfgRes.json() : { enabled: false }
        const me = meRes.ok ? await meRes.json() : { user: null }
        if (!alive) return
        setEnabled(Boolean(cfg.enabled))
        setUserId(me.user?.id ?? null)
      } catch {
        if (alive) setEnabled(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // count real input events
  useEffect(() => {
    const bump = () => {
      inputCountRef.current++
    }
    window.addEventListener('keydown', bump)
    window.addEventListener('pointerdown', bump)
    window.addEventListener('touchstart', bump, { passive: true })
    return () => {
      window.removeEventListener('keydown', bump)
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('touchstart', bump)
    }
  }, [])

  const stopBeat = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  // run lifecycle — the game page calls beginRun(); we pick up the token
  useEffect(() => {
    const unsub = subscribeRunToken((t) => {
      tokenRef.current = t
    })
    return unsub
  }, [])

  useEffect(() => {
    if (enabled !== true) return

    if (phase !== 'playing' && tokenRef.current && phase !== 'paused' && phase !== 'upgrade') {
      // run ended (gameover or quit) — send stats once, clear token
      const token = tokenRef.current
      tokenRef.current = null
      stopBeat()
      const stats = lastStatsRef.current
      if (stats && (phase === 'gameover' || phase === 'menu')) {
        void (async () => {
          try {
            const res = await fetch('/api/rewards/run-end', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token,
                score: stats.score,
                wave: stats.wave,
                kills: stats.kills,
                timeAlive: stats.timeAlive,
              }),
            })
            if (res.ok) {
              const data = (await res.json()) as {
                runPoints: number
                challengePoints: number
                challengeMetFlag: boolean
                challenge: { desc: string } | null
              }
              const gained = data.runPoints + data.challengePoints
              if (gained > 0) {
                toast({
                  title: `+${gained} REWARD POINTS`,
                  description: data.challengeMetFlag
                    ? `Daily challenge complete — ${data.challenge?.desc ?? ''}`
                    : 'Keep playing to earn more.',
                })
              }
              const sum = await fetch('/api/rewards/summary', { cache: 'no-store' })
              if (sum.ok) {
                const s = (await sum.json()) as { today: { earned: number; cap: number } }
                setToday(s.today)
              }
            }
          } catch {
            // ignore
          }
        })()
      }
    }
  }, [phase, enabled, userId, toast])

  // heartbeat interval while playing
  useEffect(() => {
    if (enabled !== true || phase !== 'playing') return
    const beat = async () => {
      const token = tokenRef.current
      if (!token) return
      const inputEvents = inputCountRef.current
      inputCountRef.current = 0
      try {
        const res = await fetch('/api/rewards/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            visible: document.visibilityState === 'visible',
            inputEvents,
          }),
        })
        if (res.ok) {
          const data = (await res.json()) as HeartbeatResponse
          if (data.todayEarned !== undefined && data.todayCap !== undefined) {
            setToday({ earned: data.todayEarned, cap: data.todayCap })
          }
        } else if (res.status === 409 || res.status === 404) {
          tokenRef.current = null // session ended server-side
        }
      } catch {
        // offline — next beat will retry
      }
    }
    // first beat after one interval, not immediately
    intervalRef.current = setInterval(() => void beat(), 30_000)
    return stopBeat
  }, [enabled, phase])

  // render nothing when disabled or not signed in
  if (enabled !== true) return null
  if (!userId) {
    if (phase !== 'menu') return null
    return (
      <Link
        href="/login"
        className="absolute bottom-3 right-3 z-20 rounded border border-amber-900/50 bg-black/70 px-3 py-1.5 text-[9px] tracking-[0.25em] text-amber-500/90 transition-colors hover:border-amber-600 hover:text-amber-400"
      >
        SIGN IN TO EARN REWARD POINTS
      </Link>
    )
  }

  if (!today || phase === 'menu') return null
  const pct = today.cap > 0 ? Math.min(100, (today.earned / today.cap) * 100) : 0
  return (
    <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded border border-amber-900/40 bg-black/60 px-2.5 py-1.5 text-[10px] tracking-widest text-amber-400/90">
      <Coins className="h-3.5 w-3.5" />
      <span className="font-black">
        {today.earned}/{today.cap}
      </span>
      <span className="hidden text-[8px] text-amber-700 sm:inline">PTS TODAY</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-sm bg-stone-900">
        <span
          className="block h-full bg-gradient-to-r from-amber-600 to-amber-400"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  )
}
