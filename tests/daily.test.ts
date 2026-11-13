// Daily-challenge system tests.
// Pure parts (tz, seed, plausibility, streak math) + real-temp-DB tests for
// the board/rank/streak persistence (same pattern as ledger.test.ts).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { dateKeyForTz, dateKeyMinus, isValidDateKey, previousDateKey } from '../src/lib/daily/tz'
import { dailySeedFor, seedMatches } from '../src/lib/daily/seed'
import { checkPlausibility } from '../src/lib/daily/plausibility'
import { extendStreak, mergeStreaks, type StreakState } from '../src/lib/daily/streaks'
import { dailyBoard, dailyRank, dailyBest, recordDailyRun, getStreak, upsertStreak } from '../src/lib/daily/board'
import { manifest as stackManifest } from '../src/games/stack/manifest'

// ---------------------------------------------------------------- tz

describe('daily tz', () => {
  it('IST midnight boundary: 18:29Z is yesterday, 18:31Z is the next day', () => {
    const tz = 'Asia/Kolkata'
    expect(dateKeyForTz(new Date('2026-11-13T18:29:00Z'), tz)).toBe('2026-11-13')
    expect(dateKeyForTz(new Date('2026-11-13T18:31:00Z'), tz)).toBe('2026-11-14')
  })

  it('DST zones use wall-clock days (America/New_York spring forward)', () => {
    const tz = 'America/New_York'
    // 2026-03-08 02:00 local jumps to 03:00 — the formatter must not throw
    const before = dateKeyForTz(new Date('2026-03-08T06:59:00Z'), tz) // 01:59 EST
    const after = dateKeyForTz(new Date('2026-03-08T07:01:00Z'), tz) // 03:01 EDT
    expect(before).toBe('2026-03-08')
    expect(after).toBe('2026-03-08')
  })

  it('previousDateKey walks back exactly one calendar day', () => {
    expect(previousDateKey(new Date('2026-11-13T10:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-12')
    expect(previousDateKey(new Date('2026-01-01T04:00:00Z'), 'Asia/Kolkata')).toBe('2025-12-31')
    // across a DST boundary the hour-walk still lands on the right day
    expect(previousDateKey(new Date('2026-03-09T12:00:00Z'), 'America/New_York')).toBe('2026-03-08')
  })

  it('dateKeyMinus does UTC calendar arithmetic', () => {
    expect(dateKeyMinus('2026-11-13', 1)).toBe('2026-11-12')
    expect(dateKeyMinus('2026-11-01', 1)).toBe('2026-10-31')
    expect(dateKeyMinus('2026-03-01', 1)).toBe('2026-02-28')
  })

  it('validates dateKey format strictly', () => {
    expect(isValidDateKey('2026-11-13')).toBe(true)
    expect(isValidDateKey('2026-13-45')).toBe(false)
    expect(isValidDateKey('not-a-date')).toBe(false)
    expect(isValidDateKey('2026-2-3')).toBe(false)
  })
})

// ---------------------------------------------------------------- seed

describe('daily seed', () => {
  beforeAll(() => {
    process.env.DAILY_SALT = 'test-salt-abcdef'
  })

  it('same slug+day+salt → same seed; everyone plays the same challenge', () => {
    expect(dailySeedFor('stack', '2026-11-13')).toBe(dailySeedFor('stack', '2026-11-13'))
  })

  it('different slug or day → different seed', () => {
    const a = dailySeedFor('stack', '2026-11-13')
    expect(a).not.toBe(dailySeedFor('merge', '2026-11-13'))
    expect(a).not.toBe(dailySeedFor('stack', '2026-11-14'))
  })

  it('seedMatches validates client-reported seeds', () => {
    const seed = dailySeedFor('stack', '2026-11-13')
    expect(seedMatches('stack', '2026-11-13', seed)).toBe(true)
    expect(seedMatches('stack', '2026-11-13', (seed + 1) >>> 0)).toBe(false)
  })
})

// ---------------------------------------------------------------- plausibility

describe('plausibility', () => {
  it('rejects runs shorter than the manifest minimum', () => {
    const v = checkPlausibility(stackManifest, { score: 3, durationMs: 1_500 })
    expect(v.ok).toBe(false)
  })

  it('rejects impossible scores for the duration', () => {
    // stack ceiling 5/s; 900 points in 20s is fabrication
    const v = checkPlausibility(stackManifest, { score: 900, durationMs: 20_000 })
    expect(v.ok).toBe(false)
  })

  it('accepts honest runs (with grace for fast rounds)', () => {
    expect(checkPlausibility(stackManifest, { score: 30, durationMs: 12_000 }).ok).toBe(true)
    // grace: a quick 4s run scoring 30 (5/s × (4+5)s = 45 ceiling) passes
    expect(checkPlausibility(stackManifest, { score: 30, durationMs: 4_000 }).ok).toBe(true)
  })
})

// ---------------------------------------------------------------- streaks (pure)

describe('streak math', () => {
  it('first ever run starts a streak of 1', () => {
    const s = extendStreak(null, '2026-11-13', '2026-11-12')
    expect(s).toEqual({ current: 1, longest: 1, lastDateKey: '2026-11-13' })
  })

  it('same-day runs are idempotent — no double counting', () => {
    const day1 = extendStreak(null, '2026-11-13', '2026-11-12')
    const again = extendStreak(day1, '2026-11-13', '2026-11-12')
    expect(again).toEqual(day1)
  })

  it('consecutive days extend; a gap resets to 1 but keeps longest', () => {
    let s: StreakState | null = null
    s = extendStreak(s, '2026-11-11', '2026-11-10')
    s = extendStreak(s, '2026-11-12', '2026-11-11')
    s = extendStreak(s, '2026-11-13', '2026-11-12')
    expect(s).toEqual({ current: 3, longest: 3, lastDateKey: '2026-11-13' })
    // skips a day → fresh streak, longest preserved
    s = extendStreak(s, '2026-11-15', '2026-11-14')
    expect(s).toEqual({ current: 1, longest: 3, lastDateKey: '2026-11-15' })
  })

  it('merge: same last day keeps the longer chain', () => {
    const server: StreakState = { current: 2, longest: 5, lastDateKey: '2026-11-13' }
    const guest: StreakState = { current: 7, longest: 7, lastDateKey: '2026-11-13' }
    const merged = mergeStreaks(server, guest, '2026-11-13', '2026-11-12')
    expect(merged.current).toBe(7)
    expect(merged.longest).toBe(7)
  })

  it('merge: adjacent chains concatenate (server yesterday, guest today)', () => {
    const server: StreakState = { current: 4, longest: 4, lastDateKey: '2026-11-12' }
    const guest: StreakState = { current: 3, longest: 3, lastDateKey: '2026-11-13' }
    const merged = mergeStreaks(server, guest, '2026-11-13', '2026-11-12')
    expect(merged.current).toBe(7)
    expect(merged.lastDateKey).toBe('2026-11-13')
  })

  it('merge: dead chain loses to a live one; empty guest is a no-op', () => {
    const dead: StreakState = { current: 9, longest: 9, lastDateKey: '2026-11-01' }
    const live: StreakState = { current: 2, longest: 2, lastDateKey: '2026-11-13' }
    expect(mergeStreaks(dead, live, '2026-11-13', '2026-11-12').current).toBe(2)
    expect(mergeStreaks(live, dead, '2026-11-13', '2026-11-12').current).toBe(2)
    // longest still remembers the dead chain's peak
    expect(mergeStreaks(live, dead, '2026-11-13', '2026-11-12').longest).toBe(9)
    expect(mergeStreaks(live, null, '2026-11-13', '2026-11-12')).toEqual(live)
  })
})

// ---------------------------------------------------------------- persistence

const DB_PATH = join(tmpdir(), `brutal-daily-test-${Date.now()}.db`)
let db: PrismaClient

beforeAll(() => {
  const push = spawnSync(
    'bunx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
      encoding: 'utf8',
    },
  )
  if (push.status !== 0) throw new Error('prisma db push failed: ' + push.stdout + push.stderr)
  db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
  // DailyRun.user is a real FK since 0.9.1 — create the referenced users
  void db.user.createMany({
    data: [
      { id: 'u1', email: 'u1@t.test', passwordHash: 'x' },
      { id: 'u2', email: 'u2@t.test', passwordHash: 'x' },
    ],
  }).catch(() => undefined)
})

afterAll(async () => {
  await db?.$disconnect().catch(() => undefined)
  rmSync(DB_PATH, { force: true })
  rmSync(DB_PATH + '-journal', { force: true })
})

describe('daily persistence', () => {
  it('board shows the BEST score per player, not every try', async () => {
    const day = '2026-11-13'
    await recordDailyRun(db, {
      game: 'stack', dateKey: day, userId: 'u1', name: 'ALPHA',
      score: 10, durationMs: 20_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    await recordDailyRun(db, {
      game: 'stack', dateKey: day, userId: 'u1', name: 'ALPHA',
      score: 42, durationMs: 60_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    await recordDailyRun(db, {
      game: 'stack', dateKey: day, userId: 'u1', name: 'ALPHA',
      score: 7, durationMs: 30_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    await recordDailyRun(db, {
      game: 'stack', dateKey: day, userId: null, name: 'GUEST',
      score: 20, durationMs: 60_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    const board = await dailyBoard(db, { game: 'stack', dateKey: day, viewerId: 'u1' })
    expect(board.length).toBe(2) // one entry per player
    expect(board[0]).toMatchObject({ name: 'ALPHA', score: 42, you: true })
    expect(board[1]).toMatchObject({ name: 'GUEST', score: 20 })
  })

  it('same-name guest entries collapse to one player; other days do not leak', async () => {
    const day = '2026-11-13'
    await recordDailyRun(db, {
      game: 'stack', dateKey: day, userId: null, name: 'GUEST',
      score: 30, durationMs: 60_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    const board = await dailyBoard(db, { game: 'stack', dateKey: day })
    expect(board.find((e) => e.name === 'GUEST')?.score).toBe(30) // best of 20/30
    const otherDay = await dailyBoard(db, { game: 'stack', dateKey: '2026-11-12' })
    expect(otherDay.length).toBe(0)
    const otherGame = await dailyBoard(db, { game: 'merge', dateKey: day })
    expect(otherGame.length).toBe(0)
  })

  it('rank counts distinct players above the score', async () => {
    const day = '2026-11-14'
    for (const [name, score] of [['A', 100], ['B', 80], ['C', 60]] as const) {
      await recordDailyRun(db, {
        game: 'reflex', dateKey: day, userId: null, name,
        score, durationMs: 30_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
      })
    }
    expect(await dailyRank(db, { game: 'reflex', dateKey: day, score: 90 })).toBe(2)
    expect(await dailyRank(db, { game: 'reflex', dateKey: day, score: 100 })).toBe(1)
    expect(await dailyRank(db, { game: 'reflex', dateKey: day, score: 10 })).toBe(4)
  })

  it('dailyBest returns the max for a user, null when absent', async () => {
    const day = '2026-11-15'
    await recordDailyRun(db, {
      game: 'dodge', dateKey: day, userId: 'u2', name: 'BETA',
      score: 5, durationMs: 10_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    await recordDailyRun(db, {
      game: 'dodge', dateKey: day, userId: 'u2', name: 'BETA',
      score: 9, durationMs: 20_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
    })
    expect(await dailyBest(db, { game: 'dodge', dateKey: day, userId: 'u2' })).toBe(9)
    expect(await dailyBest(db, { game: 'dodge', dateKey: day, userId: 'nobody' })).toBeNull()
  })

  it('streak upsert is stable and reads back', async () => {
    await upsertStreak(db, 'u3', { current: 1, longest: 1, lastDateKey: '2026-11-13' })
    await upsertStreak(db, 'u3', { current: 2, longest: 2, lastDateKey: '2026-11-14' })
    const s = await getStreak(db, 'u3')
    expect(s).toEqual({ current: 2, longest: 2, lastDateKey: '2026-11-14' })
  })

  it('input log is capped by the caller (route applies the cap)', async () => {
    const id = await recordDailyRun(db, {
      game: 'merge', dateKey: '2026-11-16', userId: null, name: 'LOGS',
      score: 100, durationMs: 30_000, seedUsed: 1, ranked: true,
      inputLog: 'x'.repeat(16_384),
    })
    const row = await db.dailyRun.findUniqueOrThrow({ where: { id } })
    expect((row.inputLog ?? '').length).toBe(16_384)
  })
})
