import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGame } from '@/games/registry'
import { getPortalConfig } from '@/lib/daily/config'
import { checkPlausibility } from '@/lib/daily/plausibility'
import {
  dailyBoard,
  dailyRank,
  getStreak,
  recordDailyRun,
  upsertStreak,
} from '@/lib/daily/board'
import { extendStreak, mergeStreaks, type StreakState } from '@/lib/daily/streaks'
import { dailySeedFor, seedMatches } from '@/lib/daily/seed'
import { dateKeyForTz, previousDateKey } from '@/lib/daily/tz'
import { limit, tooMany } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const RunSchema = z.object({
  game: z.enum(['arena', 'stack', 'reflex', 'dodge', 'merge']),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(1).max(16),
  score: z.number().int().min(0).max(100_000_000),
  durationMs: z.number().int().min(0).max(24 * 3600_000),
  /** the seed the client actually played with */
  seed: z.number().int().min(0).max(0xffffffff),
  /** client asserts it used the server seed (offline fallback = false) */
  ranked: z.boolean().default(true),
  inputLog: z.string().max(32_768).optional().nullable(),
  /** guest streak from localStorage, merged into the server streak on sync */
  clientStreak: z
    .object({
      current: z.number().int().min(0).max(10_000),
      longest: z.number().int().min(0).max(10_000),
      lastDateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional()
    .nullable(),
})

/**
 * POST /api/daily/run — record a completed daily run.
 * Zod-validated, rate-limited, plausibility-checked against the manifest.
 * Streaks count one day per player (idempotent). Input logs are stored
 * size-capped but NOT replay-verified in v1 (documented limitation).
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!limit(`daily-run:${ip}`, 12, 60_000).ok) return tooMany(60)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = RunSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid run payload' }, { status: 400 })
  }
  const run = parsed.data

  const game = getGame(run.game)
  if (!game || !game.dailyEnabled) {
    return NextResponse.json({ error: 'Daily not available for this game' }, { status: 400 })
  }

  const cfg = await getPortalConfig()
  const now = new Date()
  const todayKey = dateKeyForTz(now, cfg.DAILY_TZ)
  const yesterdayKey = previousDateKey(now, cfg.DAILY_TZ)

  // no backdating / future dating: only today's challenge accepts runs
  if (run.dateKey !== todayKey) {
    return NextResponse.json(
      { error: 'That daily challenge is no longer active', dateKey: todayKey },
      { status: 400 },
    )
  }

  // plausibility vs manifest (impossible scores rejected outright)
  const verdict = checkPlausibility(game, { score: run.score, durationMs: run.durationMs })
  if (!verdict.ok) {
    return NextResponse.json({ error: `Run rejected: ${verdict.reason}` }, { status: 422 })
  }

  // ranking: only runs on the exact server seed count as ranked
  const ranked = run.ranked && seedMatches(run.game, run.dateKey, run.seed)

  const user = await getSessionUser()
  const name = (run.name || 'ANON').slice(0, 16).toUpperCase()
  const userId = user && user.status === 'ACTIVE' ? user.id : null

  // log stored size-capped (plain string cap; compression happens client-side)
  const logCap = cfg.DAILY_INPUT_LOG_MAX_CHARS
  const inputLog = run.inputLog ? run.inputLog.slice(0, logCap) : null

  try {
    await recordDailyRun(db, {
      game: run.game,
      dateKey: run.dateKey,
      userId,
      name,
      score: run.score,
      durationMs: run.durationMs,
      seedUsed: run.seed,
      ranked,
      inputLog,
    })

    // streaks (signed-in only; guests keep theirs in localStorage)
    let streak: StreakState | null = null
    let countedToday = false
    if (userId) {
      const server = await getStreak(db, userId)
      const base = run.clientStreak
        ? mergeStreaks(server, run.clientStreak, todayKey, yesterdayKey)
        : server
      streak = extendStreak(base, todayKey, yesterdayKey)
      countedToday = true
      await upsertStreak(db, userId, {
        current: streak.current,
        longest: streak.longest,
        lastDateKey: streak.lastDateKey,
      })
    }

    const [rank, board] = await Promise.all([
      dailyRank(db, { game: run.game, dateKey: run.dateKey, score: run.score }),
      dailyBoard(db, { game: run.game, dateKey: run.dateKey, viewerId: userId }),
    ])

    return NextResponse.json({
      ok: true,
      ranked,
      rank,
      board,
      streak,
      countedToday,
    })
  } catch (err) {
    console.error('POST /api/daily/run failed', err)
    return NextResponse.json({ error: 'Failed to record run' }, { status: 500 })
  }
}

/** The authoritative seed is never exposed here — see /api/daily/seed. */
export async function GET() {
  return NextResponse.json({ error: 'Use POST to submit a run' }, { status: 405 })
}
