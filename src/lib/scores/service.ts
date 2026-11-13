// Score-submission service — C3 fix. All global-board writes go through
// recordScore():
//   - login required (enforced by the route; guests fall back to the local
//     localStorage board exactly like the static export)
//   - RANKED requires a valid run-session token issued by POST /api/run/start
//     at run start; the claim is single-use and order-independent from the
//     rewards run-end
//   - ranked runs are plausibility-checked against the SERVER-measured
//     duration (session startedAt → now), not any client-claimed time
//   - the board name is ALWAYS the account callsign (User.name/nameKey) —
//     client-supplied names never reach ranked boards (impersonation fix)
//   - entries without a valid token are stored display-only (ranked=false)
//     and excluded from the competitive board

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
import { claimScoreForSession } from '@/lib/rewards/heartbeat'
import { getGame } from '@/games/registry'
import { claimDisplayName } from '@/lib/names'
import { checkScoreAnomaly } from '@/lib/scores/stats'
import { userRisk, hasConfirmedFraud } from '@/lib/risk'

export const GAMES = ['arena', 'stack', 'reflex', 'dodge', 'merge'] as const
export type Game = (typeof GAMES)[number]

export interface ScoreInput {
  userId: string
  game: Game
  score: number
  wave: number
  kills: number
  runToken?: string | null
}

export interface BoardEntryRow {
  id: string
  name: string
  score: number
  wave: number
  kills: number
  game: string
}

export interface BoardTotals {
  runs: number
  kills: number
  top: number
}

export type RecordScoreResult =
  | { kind: 'IMPLAUSIBLE'; reason: string }
  | { kind: 'NAME_ERROR'; reason: string }
  | {
      kind: 'ok'
      ranked: boolean
      rankReason?: string
      entry: BoardEntryRow
      rank: number
      board: BoardEntryRow[]
      /** statistical evaluation vs own history + population (flag-only) */
      anomaly?: 'ok' | 'watch' | 'anomaly' | null
      /** true when stored pending verification (top-3 or high risk) */
      pending: boolean
    }

/** seconds of slack so fast legit runs (early death) still pass the ceiling */
const GRACE_SECONDS = 5
/** entries that would enter the top N of a board wait for verification */
const PENDING_TOP_N = 3
/** pending entries from LOW-risk players auto-release after this long */
const PENDING_AUTO_RELEASE_MS = 24 * 3600_000

export async function recordScore(
  input: ScoreInput,
  dbx: PrismaClient = defaultDb,
  now: Date = new Date(),
): Promise<RecordScoreResult> {
  let ranked = false
  let rankReason: string | undefined

  if (input.runToken) {
    const claim = await claimScoreForSession(input.userId, input.runToken, input.game, dbx, now)
    if (claim.ok) {
      // plausibility vs the SERVER-measured duration (ceiling only — early
      // deaths are legitimate; impossible score rates are not)
      const manifest = getGame(input.game)
      if (manifest) {
        const ceiling = manifest.maxScorePerSecond * (claim.durationSec + GRACE_SECONDS)
        if (input.score > ceiling) {
          return { kind: 'IMPLAUSIBLE', reason: 'score implausible for measured run duration' }
        }
      }
      ranked = true
    } else {
      rankReason = claim.code
    }
  }

  // adjudicated cheaters never rank again (their entries stay display-only)
  if (ranked && (await hasConfirmedFraud(input.userId, dbx))) {
    ranked = false
    rankReason = 'CONFIRMED_FRAUD'
  }

  // pending verification: HIGH auto-HOLD risk, or an entry entering the top N
  let pending = false
  if (ranked) {
    const risk = await userRisk(input.userId, dbx)
    if (risk.level === 'HIGH') {
      pending = true
    } else {
      const better = await dbx.highScore.count({
        where: { game: input.game, ranked: true, pending: false, removedAt: null, score: { gte: input.score } },
      })
      if (better < PENDING_TOP_N) pending = true
    }
  }

  // board name = account callsign (auto-generated PILOT-XXXX on first post)
  const name = await claimDisplayName(input.userId, null, dbx)
  if (!name.ok) {
    return { kind: 'NAME_ERROR', reason: name.reason ?? 'Could not set a callsign.' }
  }

  const created = await dbx.highScore.create({
    data: {
      name: name.name,
      score: input.score,
      wave: input.wave,
      kills: input.kills,
      game: input.game,
      userId: input.userId,
      ranked,
      pending,
    },
  })

  const rank = ranked && !pending
    ? (await dbx.highScore.count({
        where: { game: input.game, ranked: true, pending: false, removedAt: null, score: { gt: input.score } },
      })) + 1
    : 0

  const board = await rankedBoard(input.game, dbx)

  // statistical layer (flag-only — never blocks the entry)
  const anomaly = ranked ? await checkScoreAnomaly(input.userId, input.game, input.score, dbx) : null

  return {
    kind: 'ok',
    ranked,
    rankReason,
    entry: {
      id: created.id,
      name: created.name,
      score: created.score,
      wave: created.wave,
      kills: created.kills,
      game: created.game,
    },
    rank,
    board,
    anomaly: anomaly ? anomaly.level : null,
    pending,
  }
}

/**
 * Auto-release pending entries older than 24h whose author's risk has fallen
 * back to LOW (false-positive path). Throttled; called opportunistically.
 */
let lastPendingSweep = 0
export async function releaseStalePending(
  dbx: PrismaClient = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  if (now.getTime() - lastPendingSweep < 10 * 60_000) return 0
  lastPendingSweep = now.getTime()
  const stale = await dbx.highScore.findMany({
    where: { pending: true, removedAt: null, createdAt: { lt: new Date(now.getTime() - PENDING_AUTO_RELEASE_MS) } },
    select: { id: true, userId: true },
    take: 50,
  })
  let released = 0
  for (const row of stale) {
    if (!row.userId) continue
    const risk = await userRisk(row.userId, dbx)
    if (risk.level === 'LOW') {
      await dbx.highScore.update({ where: { id: row.id }, data: { pending: false } }).catch(() => undefined)
      released++
    }
  }
  return released
}

/** Top-10 competitive board + totals — verified RANKED entries only. */
export async function rankedBoard(
  game: Game,
  dbx: PrismaClient = defaultDb,
): Promise<BoardEntryRow[]> {
  const rows = await dbx.highScore.findMany({
    where: { game, ranked: true, pending: false, removedAt: null },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: 10,
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    score: r.score,
    wave: r.wave,
    kills: r.kills,
    game: r.game,
  }))
}

export async function boardTotals(game: Game, dbx: PrismaClient = defaultDb): Promise<BoardTotals> {
  const agg = await dbx.highScore.aggregate({
    where: { game, ranked: true, pending: false, removedAt: null },
    _count: true,
    _sum: { kills: true },
    _max: { score: true },
  })
  return {
    runs: agg._count,
    kills: agg._sum.kills ?? 0,
    top: agg._max.score ?? 0,
  }
}
