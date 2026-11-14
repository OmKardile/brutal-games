'use client'

// DailyPanel — client side of /daily. Lists every daily-enabled game with
// today's dateKey, the player's streak (server-side when signed in,
// localStorage as a guest) and a PLAY DAILY deep link. The boards load
// lazily per game; on static deploys everything degrades to links only.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, Trophy } from 'lucide-react'
import { GAMES } from '@/games/registry'

interface Summary {
  dateKey: string
  dailyEnabled: boolean
  signedIn: boolean
  myBest: number | null
  streak: { current: number; longest: number; lastDateKey: string } | null
}

const GUEST_STREAK_KEY = 'brutal.daily.streak'

export function DailyPanel() {
  const [dateKey, setDateKey] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  const [guestStreak, setGuestStreak] = useState<{ current: number; longest: number } | null>(null)

  const load = useCallback(async () => {
    const next: Record<string, Summary> = {}
    await Promise.all(
      GAMES.filter((g) => g.dailyEnabled).map(async (g) => {
        try {
          const res = await fetch(`/api/daily/summary?game=${g.slug}`, { cache: 'no-store' })
          if (res.ok) next[g.slug] = (await res.json()) as Summary
        } catch {
          // offline/static — links still work
        }
      }),
    )
    setSummaries(next)
    const first = Object.values(next)[0]
    if (first?.dateKey) setDateKey(first.dateKey)
    try {
      const raw = window.localStorage.getItem(GUEST_STREAK_KEY)
      if (raw) setGuestStreak(JSON.parse(raw) as { current: number; longest: number })
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const streak = (() => {
    const s = Object.values(summaries).find((x) => x.streak)
    if (s?.streak) return { current: s.streak.current, longest: s.streak.longest, signedIn: true }
    if (guestStreak) return { ...guestStreak, signedIn: false }
    return null
  })()

  return (
    <div>
      {/* streak banner + festival calendar link (roadmap slice 3) */}
      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
        <Flame className="h-6 w-6 text-amber-500" />
        <div>
          <div className="text-sm font-black tracking-widest text-amber-400">
            {streak ? `${streak.current}-DAY STREAK` : 'START A STREAK'}
          </div>
          <div className="text-[11px] text-[var(--ink-dim)]">
            {streak
              ? `Longest: ${streak.longest} days · ${streak.signedIn ? 'synced to your account' : 'saved in this browser — sign in to sync'}`
              : 'Finish one daily run (any game) to light the first flame.'}
          </div>
        </div>
        {dateKey && (
          <div className="ml-auto text-right">
            <div className="text-[9px] tracking-[0.3em] text-[var(--ink-faint)]">TODAY</div>
            <div className="font-mono text-xs text-[var(--ink-dim)]">{dateKey}</div>
          </div>
        )}
        <Link
          href="/daily/festivals"
          className="rounded border border-fuchsia-700/60 bg-fuchsia-950/30 px-3 py-1.5 text-[9px] font-black tracking-[0.3em] text-fuchsia-300 transition-colors hover:bg-fuchsia-900/40"
        >
          FESTIVAL CALENDAR
        </Link>
      </div>

      {/* per-game rows */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {GAMES.filter((g) => g.dailyEnabled).map((g) => {
          const s = summaries[g.slug]
          return (
            <div
              key={g.slug}
              className="flex items-center justify-between gap-4 rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] p-4"
            >
              <div>
                <div className="font-[family-name:var(--font-display)] text-xl font-black tracking-tight">
                  {g.shortName}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--ink-dim)]">
                  {s?.myBest != null && (
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="h-3 w-3 text-amber-500" /> your best today:{' '}
                      <span className="font-bold text-[var(--ink)]">{s.myBest}</span>
                    </span>
                  )}
                  {s && !s.signedIn && <span>sign in to track your best</span>}
                </div>
              </div>
              <Link
                href={`/games/${g.slug}?daily=1`}
                className="shrink-0 rounded border border-amber-500/60 bg-amber-600 px-4 py-2.5 text-[10px] font-black tracking-[0.25em] text-black transition-colors hover:bg-amber-500"
              >
                PLAY DAILY
              </Link>
            </div>
          )
        })}
      </div>

      <p className="mt-6 max-w-2xl text-[11px] leading-relaxed text-[var(--ink-faint)]">
        How it works: everyone gets the SAME seeded challenge each day (the day rolls over at
        midnight IST). Unlimited tries — your best score counts. Offline runs use a local seed
        and are marked UNRANKED. Daily leaderboards never pay cash; rewards stay
        engagement-based only.
      </p>
    </div>
  )
}
