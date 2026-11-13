// Daily board queries + run recording (DB side).
//
// DailyRun is APPEND-ONLY (unlimited tries): the board computes the best
// score per player (userId when signed in, name when a guest) from the top
// slice of rows. SQLite scale is fine: rate limits cap writes and the query
// window is one game + one day.

import type { PrismaClient } from '@prisma/client'
import type { GameSlug } from '@/games/types'

export interface DailyBoardEntry {
  id: string
  name: string
  score: number
  durationMs: number
  ranked: boolean
  createdAt: string // ISO
  /** true when this row belongs to the requesting player */
  you?: boolean
}

function playerKey(userId: string | null, name: string): string {
  return userId ? `u:${userId}` : `n:${name.toUpperCase()}`
}

/** Top N best-per-player rows for a game+day. */
export async function dailyBoard(
  db: PrismaClient,
  opts: { game: GameSlug; dateKey: string; limit?: number; viewerId?: string | null },
): Promise<DailyBoardEntry[]> {
  const limit = opts.limit ?? 10
  // fetch a wide slice ordered by score, then reduce to best-per-player
  const rows = await db.dailyRun.findMany({
    where: { game: opts.game, dateKey: opts.dateKey },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: 300,
  })
  const best = new Map<string, DailyBoardEntry>()
  for (const r of rows) {
    const key = playerKey(r.userId, r.name)
    if (!best.has(key)) {
      best.set(key, {
        id: r.id,
        name: r.name,
        score: r.score,
        durationMs: r.durationMs,
        ranked: r.ranked,
        createdAt: r.createdAt.toISOString(),
        you: opts.viewerId ? r.userId === opts.viewerId : undefined,
      })
    }
    if (best.size >= limit * 3) break // enough candidates for top-limit after sort
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit)
}

/** A player's best score for a game+day (null when they haven't played). */
export async function dailyBest(
  db: PrismaClient,
  opts: { game: GameSlug; dateKey: string; userId?: string | null; name?: string },
): Promise<number | null> {
  const where = opts.userId
    ? { game: opts.game, dateKey: opts.dateKey, userId: opts.userId }
    : { game: opts.game, dateKey: opts.dateKey, name: opts.name ?? '' }
  const agg = await db.dailyRun.aggregate({ where, _max: { score: true } })
  return agg._max.score ?? null
}

export interface RecordRunInput {
  game: GameSlug
  dateKey: string
  userId: string | null
  name: string
  score: number
  durationMs: number
  seedUsed: number
  ranked: boolean
  inputLog: string | null
}

/** Append a completed run. Returns the row id. */
export async function recordDailyRun(db: PrismaClient, run: RecordRunInput): Promise<string> {
  const row = await db.dailyRun.create({
    data: {
      game: run.game,
      dateKey: run.dateKey,
      userId: run.userId,
      name: run.name,
      score: run.score,
      durationMs: run.durationMs,
      // uint32 seed → int32 storage (SQLite INT is signed 32-bit);
      // read back with `>>> 0` to recover the unsigned value.
      seedUsed: run.seedUsed | 0,
      ranked: run.ranked,
      inputLog: run.inputLog,
    },
  })
  return row.id
}

/** Rank of a score among best-per-player entries (1-based). */
export async function dailyRank(
  db: PrismaClient,
  opts: { game: GameSlug; dateKey: string; score: number },
): Promise<number> {
  const rows = await db.dailyRun.findMany({
    where: { game: opts.game, dateKey: opts.dateKey },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: 300,
    select: { userId: true, name: true, score: true },
  })
  const best = new Map<string, number>()
  for (const r of rows) {
    const key = playerKey(r.userId, r.name)
    if (!best.has(key)) best.set(key, r.score)
  }
  const scores = [...best.values()].sort((a, b) => b - a)
  const idx = scores.findIndex((s) => s <= opts.score)
  return idx === -1 ? scores.length + 1 : idx + 1
}

/** Server-side streak row upsert. Returns the (possibly updated) state. */
export async function upsertStreak(
  db: PrismaClient,
  userId: string,
  next: { current: number; longest: number; lastDateKey: string },
): Promise<void> {
  await db.dailyStreak.upsert({
    where: { userId },
    create: { userId, ...next },
    update: next,
  })
}

export async function getStreak(
  db: PrismaClient,
  userId: string,
): Promise<{ current: number; longest: number; lastDateKey: string } | null> {
  return db.dailyStreak.findUnique({
    where: { userId },
    select: { current: true, longest: true, lastDateKey: true },
  })
}
