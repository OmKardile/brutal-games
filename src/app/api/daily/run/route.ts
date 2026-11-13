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
import { claimDailyScoreForSession } from '@/lib/rewards/heartbeat'
import { userRisk } from '@/lib/risk'
import { csrfBlocked } from '@/lib/http'
import { limit, tooMany } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { clientIp } from '@/lib/env'
import { sanitizeNameInput, namePolicyError, claimDisplayName } from '@/lib/names'
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
  /** signed run token from /api/run/start (required for RANKED submissions) */
  runToken: z.string().min(20).max(1024).optional(),
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
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const ip = clientIp(req)
  if (!(await limit(`daily-run:${ip}`, 12, 60_000)).ok) return tooMany(60)
  // M3 partial fix: per-user cap on top of the per-IP bucket
  const preUser = await getSessionUser()
  if (preUser && !(await limit(`daily-run:user:${preUser.id}`, 12, 60_000)).ok) {
    return tooMany(60)
  }

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

  // ranking (phase 3): a run counts as RANKED only when
  //  1. the client asserts it played the server seed, AND
  //  2. the seed matches the authoritative daily seed, AND
  //  3. a signed run token is presented that binds exactly that seed and game
  //     (single-use claim against the server-clocked session)
  let ranked = run.ranked && seedMatches(run.game, run.dateKey, run.seed)
  if (ranked) {
    if (preUser && preUser.status === 'ACTIVE' && run.runToken) {
      const claim = await claimDailyScoreForSession(
        preUser.id,
        run.runToken,
        { game: run.game, seed: run.seed },
        db,
      )
      if (!claim.ok) {
        ranked = false // token missing/invalid/reused/seed-mismatched → display-only
      }
    } else {
      ranked = false // no session user or no token → display-only
    }
  }

  const activeUser = preUser && preUser.status === 'ACTIVE' ? preUser : null

  // pending verification (phase 4): ranked runs from HIGH-risk players are
  // stored pending admin verification; never auto-removed
  let pending = false
  if (ranked && activeUser) {
    const risk = await userRisk(activeUser.id, db)
    if (risk.level === 'HIGH') pending = true
  }

  // board name: account callsign for signed-in players (uniqueness by
  // nameKey); policy-checked sanitized name for guests (M2 fix)
  let name: string
  if (activeUser) {
    const claimed = await claimDisplayName(activeUser.id, null)
    if (claimed.ok) {
      name = claimed.name
    } else {
      return NextResponse.json({ error: claimed.reason ?? 'Could not set a callsign.' }, { status: 400 })
    }
  } else {
    const clean = sanitizeNameInput(run.name || 'ANON')
    const policyErr = namePolicyError(clean || 'ANON')
    if (policyErr) {
      return NextResponse.json({ error: policyErr }, { status: 400 })
    }
    name = clean.toUpperCase()
  }
  const userId = activeUser?.id ?? null

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
      pending,
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
