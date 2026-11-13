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
    }

/** seconds of slack so fast legit runs (early death) still pass the ceiling */
const GRACE_SECONDS = 5

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
    },
  })

  const rank = ranked
    ? (await dbx.highScore.count({
        where: { game: input.game, ranked: true, score: { gt: input.score } },
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
  }
}

/** Top-10 competitive board + totals — RANKED entries only. */
export async function rankedBoard(
  game: Game,
  dbx: PrismaClient = defaultDb,
): Promise<BoardEntryRow[]> {
  const rows = await dbx.highScore.findMany({
    where: { game, ranked: true },
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
    where: { game, ranked: true },
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
