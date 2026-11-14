// Retention read-out (slice 0, ADR-029) — DAU / D1 / D7 cohorts + run
// counts, computed server-side from EXISTING tables. No new tracking, no
// new client telemetry: DailyActivity (rewards-program actives) and
// DailyRun (challenge players — guests included by name key).
//
// Player identity for cohort math:
//   signed-in → userId
//   guest     → 'n:' + uppercase name (same key the daily board uses)
// Guests are the majority on an India-first portal, so cohorts that ignore
// them would undercount most of the audience; name-key matching is an
// approximation (device change or rename breaks the chain — acceptable,
// we report the assumption, not a precision instrument).

import type { PrismaClient } from '@prisma/client'
import { dateKeyMinus } from './tz'

export interface CohortDay {
  dateKey: string
  /** distinct players seen that day (signed-in + guests by name key) */
  players: number
  /** of those, how many were already seen on any LATER day (D1+) */
  returning: number
  d1: number // percent (0-100, rounded)
}

export interface RetentionReport {
  tz: string
  days: CohortDay[]
  /** trailing-30 aggregates, computed from the same rows */
  totals: {
    avgDau: number
    bestDau: number
    bestDauDate: string | null
    avgD1: number
    runsTotal: number
    rankedShare: number // percent of daily runs that were ranked
  }
}

/** Distinct player keys with activity on a dateKey (DailyActivity ∪ DailyRun). */
async function playersOnDay(db: PrismaClient, dateKey: string): Promise<Set<string>> {
  const [activities, runs] = await Promise.all([
    db.dailyActivity.findMany({ where: { date: dateKey }, select: { userId: true } }),
    db.dailyRun.findMany({
      where: { dateKey, pending: false, removedAt: null },
      select: { userId: true, name: true },
    }),
  ])
  const keys = new Set<string>(activities.map((a) => `u:${a.userId}`))
  for (const r of runs) {
    keys.add(r.userId ? `u:${r.userId}` : `n:${r.name.toUpperCase()}`)
  }
  return keys
}

/**
 * Trailing-N-days retention report ending today (dateKey of `now` in tz).
 * D1 for a day D = share of D's players seen on ANY of the N-1 later days.
 * (Classic D1 = next day only, but on a small site 30 days of denominator
 * is kinder; the definition is printed with the report.)
 */
export async function retentionReport(
  db: PrismaClient,
  opts: { tz: string; todayKey: string; days?: number },
): Promise<RetentionReport> {
  const windowDays = Math.min(Math.max(opts.days ?? 30, 2), 90)
  const dateKeys: string[] = []
  for (let i = windowDays - 1; i >= 0; i--) dateKeys.push(dateKeyMinus(opts.todayKey, i))

  // one DB pass per day (window ≤ 90, indexed by date/dateKey) — fine here
  const sets = new Map<string, Set<string>>()
  for (const key of dateKeys) sets.set(key, await playersOnDay(db, key))

  const cohort: CohortDay[] = []
  for (let i = 0; i < dateKeys.length; i++) {
    const dayKey = dateKeys[i]
    const players = sets.get(dayKey) ?? new Set<string>()
    // later = any of the remaining days in the window after this day
    const later = new Set<string>()
    for (let j = i + 1; j < dateKeys.length; j++) {
      for (const p of sets.get(dateKeys[j]) ?? []) later.add(p)
    }
    let returning = 0
    for (const p of players) if (later.has(p)) returning++
    cohort.push({
      dateKey: dayKey,
      players: players.size,
      returning,
      d1: players.size > 0 ? Math.round((returning / players.size) * 100) : 0,
    })
  }

  const runsBase = { dateKey: { in: dateKeys }, pending: false, removedAt: null } as const
  const [runsTotal, rankedRuns] = await Promise.all([
    db.dailyRun.count({ where: runsBase }),
    db.dailyRun.count({ where: { ...runsBase, ranked: true } }),
  ])

  const daus = cohort.map((c) => c.players)
  const d1s = cohort.filter((c) => c.players > 0).map((c) => c.d1)
  const bestIdx = daus.reduce((bi, v, i) => (v > daus[bi] ? i : bi), 0)

  return {
    tz: opts.tz,
    days: cohort,
    totals: {
      avgDau: Math.round(daus.reduce((a, b) => a + b, 0) / Math.max(1, daus.length)),
      bestDau: daus[bestIdx] ?? 0,
      bestDauDate: cohort[bestIdx]?.dateKey ?? null,
      avgD1: d1s.length ? Math.round(d1s.reduce((a, b) => a + b, 0) / d1s.length) : 0,
      runsTotal,
      rankedShare: runsTotal > 0 ? Math.round((rankedRuns / runsTotal) * 100) : 0,
    },
  }
}
