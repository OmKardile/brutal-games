// Phase 2: score-submission lock-down (C3 fix) — the recordScore service
// against a REAL throwaway database. Route-level auth/CSRF live in the
// phase-8 abuse suite; here we verify the integrity logic itself.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { recordScore, rankedBoard, boardTotals } from '../src/lib/scores/service'
import { startPlaySession, claimScoreForSession, claimDailyScoreForSession } from '../src/lib/rewards/heartbeat'
import { signRunToken } from '../src/lib/run-token'
import { DEFAULT_SETTINGS } from '../src/lib/rewards/config'
import { claimDisplayName } from '../src/lib/names'

const DB_PATH = join(tmpdir(), `brutal-scores-test-${Date.now()}.db`)

let db: PrismaClient

const settings = { ...DEFAULT_SETTINGS }

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
})

afterAll(async () => {
  await db?.$disconnect().catch(() => undefined)
  rmSync(DB_PATH, { force: true })
  rmSync(DB_PATH + '-journal', { force: true })
})

async function mkUser(email: string): Promise<string> {
  const u = await db.user.create({ data: { email, passwordHash: 'x' } })
  return u.id
}

/**
 * Create a run session with a backdated start (server-signed startedAt in the
 * token + matching row) so server-measured duration is realistic.
 */
async function mkRun(userId: string, game: string, startedAgoSec: number, seed: number | null = null): Promise<string> {
  const startedAt = Date.now() - startedAgoSec * 1000
  const token = signRunToken({ uid: userId, game, seed, startedAt })
  await db.playSession.create({
    data: {
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      game,
      seed,
      startedAt: new Date(startedAt),
      ip: 'test',
      challenge: 'test-challenge',
    },
  })
  return token
}

describe('recordScore — ranked requires a valid run token', () => {
  it('ranks a submission backed by an open run session', async () => {
    const uid = await mkUser('ranked@test')
    const token = await mkRun(uid, 'arena', 120)
    const res = await recordScore(
      { userId: uid, game: 'arena', score: 5_000, wave: 5, kills: 120, runToken: token },
      db,
    )
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') {
      expect(res.ranked).toBe(true)
      expect(res.rank).toBe(1)
    }
  })

  it('stores display-only (ranked=false) without a token', async () => {
    const uid = await mkUser('unranked@test')
    const res = await recordScore(
      { userId: uid, game: 'arena', score: 999_999, wave: 99, kills: 9_999 },
      db,
    )
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') {
      expect(res.ranked).toBe(false)
      expect(res.rank).toBe(0)
    }
  })

  it('rejects an implausible score for the server-measured duration', async () => {
    const uid = await mkUser('implausible@test')
    // 10-second run claiming an arena mega-score
    const token = await mkRun(uid, 'arena', 10)
    const res = await recordScore(
      { userId: uid, game: 'arena', score: 5_000_000, wave: 5, kills: 120, runToken: token },
      db,
    )
    expect(res.kind).toBe('IMPLAUSIBLE')
  })

  it('burns the token: replaying the same token yields an unranked entry', async () => {
    const uid = await mkUser('replay@test')
    const token = await mkRun(uid, 'stack', 90)
    const first = await recordScore(
      { userId: uid, game: 'stack', score: 300, wave: 300, kills: 12, runToken: token },
      db,
    )
    expect(first.kind === 'ok' && first.ranked).toBe(true)
    const replay = await recordScore(
      { userId: uid, game: 'stack', score: 999_999, wave: 9_999, kills: 9_999, runToken: token },
      db,
    )
    expect(replay.kind === 'ok' && replay.ranked).toBe(false)
  })

  it("rejects another user's token (ownership check)", async () => {
    const owner = await mkUser('owner@test')
    const thief = await mkUser('thief@test')
    const token = await mkRun(owner, 'arena', 60)
    const res = await recordScore(
      { userId: thief, game: 'arena', score: 1_000, wave: 3, kills: 30, runToken: token },
      db,
    )
    expect(res.kind === 'ok' && res.ranked).toBe(false)
  })

  it('rejects a token bound to a different game', async () => {
    const uid = await mkUser('mismatch@test')
    const token = await mkRun(uid, 'stack', 60)
    const res = await recordScore(
      { userId: uid, game: 'arena', score: 1_000, wave: 3, kills: 30, runToken: token },
      db,
    )
    expect(res.kind === 'ok' && res.ranked).toBe(false)
    if (res.kind === 'ok') expect(res.rankReason).toBe('GAME_MISMATCH')
  })

  it('aborted (superseded) sessions do not rank', async () => {
    const uid = await mkUser('aborted@test')
    const token = await mkRun(uid, 'arena', 60)
    // a newer run supersedes it server-side
    await startPlaySession(uid, 'arena', null, settings, 'test', db)
    const res = await recordScore(
      { userId: uid, game: 'arena', score: 1_000, wave: 3, kills: 30, runToken: token },
      db,
    )
    expect(res.kind === 'ok' && res.ranked).toBe(false)
  })
})

describe('recordScore — board names are account callsigns', () => {
  it('auto-assigns a PILOT-XXXX callsign on first post and reuses it', async () => {
    const uid = await mkUser('callsign@test')
    const res1 = await recordScore(
      { userId: uid, game: 'merge', score: 500, wave: 4, kills: 40 },
      db,
    )
    expect(res1.kind).toBe('ok')
    if (res1.kind === 'ok') {
      expect(res1.entry.name).toMatch(/^PILOT-[0-9A-F]{4}$/)
      // second post keeps the same callsign
      const res2 = await recordScore(
        { userId: uid, game: 'merge', score: 700, wave: 5, kills: 50 },
        db,
      )
      expect(res2.kind === 'ok' && res2.entry.name).toBe(res1.entry.name)
    }
  })

  it('ignores the client-supplied name for the board (impersonation fix)', async () => {
    const uid = await mkUser('name@test')
    // user claims a proper callsign first
    const claim = await claimDisplayName(uid, 'NeonWolf', db)
    expect(claim.ok).toBe(true)
    const res = await recordScore(
      { userId: uid, game: 'arena', score: 2_000, wave: 3, kills: 60 },
      db,
    )
    // recordScore never sees a client name at all; board shows the callsign
    expect(res.kind === 'ok' && res.entry.name).toBe('NeonWolf')
  })

  it('callsign uniqueness: a second account cannot claim the same key', async () => {
    const a = await mkUser('clash-a@test')
    const b = await mkUser('clash-b@test')
    const first = await claimDisplayName(a, 'SHADOW', db)
    expect(first.ok).toBe(true)
    const second = await claimDisplayName(b, 'shadow', db) // case-insensitive
    expect(second.ok).toBe(false)
  })
})

describe('rankedBoard — competitive board shows ranked entries only', () => {
  it('excludes display-only entries and totals', async () => {
    const uid = await mkUser('board@test')
    await recordScore({ userId: uid, game: 'dodge', score: 10_000, wave: 10, kills: 10 }, db)
    const board = await rankedBoard('dodge', db)
    expect(board.some((e) => e.score === 10_000)).toBe(false)
    const totals = await boardTotals('dodge', db)
    expect(totals.runs).toBe(0)
  })
})

describe('claimScoreForSession — order independence with rewards run-end', () => {
  it('a session ended with RUN_END can still be scored exactly once', async () => {
    const uid = await mkUser('order@test')
    const token = await mkRun(uid, 'reflex', 60)
    // rewards run-end ends the session
    const session = await db.playSession.findFirst({
      where: { userId: uid },
      orderBy: { startedAt: 'desc' },
    })
    await db.playSession.update({
      where: { id: session!.id },
      data: { endedAt: new Date(), endedReason: 'RUN_END' },
    })
    const claim = await claimScoreForSession(uid, token, 'reflex', db)
    expect(claim.ok).toBe(true)
    const again = await claimScoreForSession(uid, token, 'reflex', db)
    expect(again.ok).toBe(false)
  })
})
