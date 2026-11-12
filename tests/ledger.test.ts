// Ledger integration tests against a REAL throwaway SQLite database.
// The schema is pushed to a temp file once; every test hits the actual
// awardPoints/voidEvents code paths (idempotency, daily cap, streaks,
// reversals) — the same ones the API routes use.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  awardPoints,
  clampByDailyCap,
  lifetimePoints,
  monthPointsByUser,
  streakAward,
  userMonthPoints,
  voidEvents,
  type AwardContext,
} from '../src/lib/rewards/points'
import { DEFAULT_SETTINGS, type RewardSettings } from '../src/lib/rewards/config'
import { istDateKey, istMonthKey, istYesterdayKey } from '../src/lib/rewards/ist'

const DB_PATH = join(tmpdir(), `brutal-ledger-test-${Date.now()}.db`)

let db: PrismaClient

const settings = (): RewardSettings => ({
  ...DEFAULT_SETTINGS,
  REWARDS_ENABLED: true,
  DAILY_POINT_CAP: 10,
  HEARTBEAT_POINTS: 1,
  STREAK_BASE: 5,
  STREAK_MAX: 30,
})

function ctx(userId: string, now?: Date, overrides?: Partial<RewardSettings>): AwardContext {
  return {
    settings: { ...settings(), ...overrides },
    user: { id: userId, status: 'ACTIVE', adultDeclaredAt: new Date() },
    ...(now ? { now } : {}),
  }
}

/** Context built from the REAL user row (status / consent from DB). */
async function realCtx(userId: string): Promise<AwardContext> {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, status: true, adultDeclaredAt: true },
  })
  return { settings: settings(), user: u }
}

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
  db = new PrismaClient({
    datasources: { db: { url: `file:${DB_PATH}` } },
  })
})

afterAll(async () => {
  await db?.$disconnect().catch(() => undefined)
  rmSync(DB_PATH, { force: true })
  rmSync(DB_PATH + '-journal', { force: true })
})

async function mkUser(id: string): Promise<string> {
  const u = await db.user.create({
    data: { email: `${id}@t.test`, passwordHash: 'x', adultDeclaredAt: new Date() },
  })
  return u.id
}

describe('awardPoints — idempotency', () => {
  it('replaying the same idempotency key never double-awards', async () => {
    const uid = await mkUser('idem')
    const key = 'test:idem:1'
    const first = await awardPoints(ctx(uid), { userId: uid, points: 5, reason: 'PLAY_TIME', idempotencyKey: key }, db)
    expect(first.kind).toBe('awarded')
    const replay = await awardPoints(ctx(uid), { userId: uid, points: 5, reason: 'PLAY_TIME', idempotencyKey: key }, db)
    expect(replay.kind).toBe('duplicate')
    // 5 (play) + 5 (day-1 streak); the replay added nothing
    expect(await lifetimePoints(uid, db)).toBe(10)
  })
})

describe('awardPoints — daily cap', () => {
  it('clamps awards at the cap and reports daily_cap', async () => {
    const uid = await mkUser('cap')
    // cap is 10; streak (5) is awarded first day — request 8 -> fits 5 after streak? no:
    // streak award happens after the main event, consuming the remainder.
    const r1 = await awardPoints(ctx(uid), { userId: uid, points: 8, reason: 'PLAY_TIME', idempotencyKey: 'cap:1' }, db)
    expect(r1.kind).toBe('awarded')
    if (r1.kind === 'awarded') expect(r1.points).toBe(8)
    // day total now: 8 + streak(5 clamped to 2) = 10 -> full
    const r2 = await awardPoints(ctx(uid), { userId: uid, points: 3, reason: 'PLAY_TIME', idempotencyKey: 'cap:2' }, db)
    expect(r2.kind).toBe('daily_cap')
    expect(await lifetimePoints(uid, db)).toBe(10)
  })

  it('clamps a single oversized award to the remaining headroom', async () => {
    const uid = await mkUser('clamp')
    const r = await awardPoints(ctx(uid), { userId: uid, points: 99, reason: 'RUN_COMPLETION', idempotencyKey: 'clamp:1' }, db)
    expect(r.kind).toBe('awarded')
    if (r.kind === 'awarded') expect(r.points).toBe(10) // full cap in one go
  })
})

describe('awardPoints — gates', () => {
  it('blocks when rewards are disabled', async () => {
    const uid = await mkUser('dis')
    const r = await awardPoints(
      { settings: { ...settings(), REWARDS_ENABLED: false }, user: { id: uid, status: 'ACTIVE', adultDeclaredAt: new Date() } },
      { userId: uid, points: 5, reason: 'PLAY_TIME', idempotencyKey: 'dis:1' },
      db,
    )
    expect(r.kind).toBe('blocked')
  })

  it('blocks frozen users and users without 18+ consent', async () => {
    const frozen = await mkUser('frozen')
    await db.user.update({ where: { id: frozen }, data: { status: 'FROZEN' } })
    expect(
      (await awardPoints(await realCtx(frozen), { userId: frozen, points: 1, reason: 'PLAY_TIME', idempotencyKey: 'f:1' }, db)).kind,
    ).toBe('blocked')

    const minor = await mkUser('minor')
    await db.user.update({ where: { id: minor }, data: { adultDeclaredAt: null } })
    expect(
      (await awardPoints(await realCtx(minor), { userId: minor, points: 1, reason: 'PLAY_TIME', idempotencyKey: 'm:1' }, db)).kind,
    ).toBe('blocked')
  })
})

describe('streaks', () => {
  it('awards the day-1 streak with the first points of the day only', async () => {
    const uid = await mkUser('streak')
    const day1 = await awardPoints(ctx(uid), { userId: uid, points: 2, reason: 'PLAY_TIME', idempotencyKey: 'st:1' }, db)
    expect(day1.kind).toBe('awarded')
    // 2 (play) + 5 (day-1 streak) = 7
    expect(await lifetimePoints(uid, db)).toBe(7)
    // second award same day — streak already counted, no extra streak points
    await awardPoints(ctx(uid), { userId: uid, points: 1, reason: 'PLAY_TIME', idempotencyKey: 'st:2' }, db)
    expect(await lifetimePoints(uid, db)).toBe(8)
  })

  it('continues the streak on consecutive days (day-2 award, capped by headroom)', async () => {
    const uid = await mkUser('streak2')
    // seed yesterday's activity row directly (streak already counted yesterday)
    await db.dailyActivity.create({
      data: { userId: uid, date: istYesterdayKey(istDateKey()), pointsEarned: 10, streakCounted: true },
    })
    const r = await awardPoints(ctx(uid), { userId: uid, points: 2, reason: 'PLAY_TIME', idempotencyKey: 'st2:1' }, db)
    expect(r.kind).toBe('awarded')
    // 2 (play) + day-2 streak min(30, 5+5)=10 clamped to headroom 8 -> +8 = 10
    expect(await lifetimePoints(uid, db)).toBe(10)
  })
})

describe('voidEvents — reversals', () => {
  it('creates a linked negative event, once per original', async () => {
    const uid = await mkUser('void')
    const a1 = await awardPoints(ctx(uid, undefined, { DAILY_POINT_CAP: 100 }), { userId: uid, points: 6, reason: 'RUN_COMPLETION', idempotencyKey: 'v:1' }, db)
    const a2 = await awardPoints(ctx(uid, undefined, { DAILY_POINT_CAP: 100 }), { userId: uid, points: 2, reason: 'PLAY_TIME', idempotencyKey: 'v:2' }, db)
    expect(a1.kind).toBe('awarded')
    expect(a2.kind).toBe('awarded')

    const e1 = a1.kind === 'awarded' ? a1.event : null
    const e2 = a2.kind === 'awarded' ? a2.event : null
    expect(e1 && e2).toBeTruthy()

    // void the first event (6 pts); streak (5) + second award (2) remain -> 7
    const r1 = await voidEvents('admin-1', uid, [e1!.id], 'fraud', db)
    expect(r1.voided).toBe(1)
    expect(await lifetimePoints(uid, db)).toBe(7)

    // voiding the same event again is skipped (one reversal per original)
    const r2 = await voidEvents('admin-1', uid, [e1!.id], 'again', db)
    expect(r2.voided).toBe(0)
    expect(r2.skipped).toContain(e1!.id)
    expect(await lifetimePoints(uid, db)).toBe(7)

    // voiding another user's event is skipped
    const other = await mkUser('void-other')
    const r3 = await voidEvents('admin-1', other, [e2!.id], 'wrong user', db)
    expect(r3.voided).toBe(0)

    // voiding an already-negative event is skipped
    const rev = await db.pointEvent.findFirst({ where: { reversalOfId: e1!.id } })
    expect(rev).toBeTruthy()
    const r4 = await voidEvents('admin-1', uid, [rev!.id], 'double reversal', db)
    expect(r4.voided).toBe(0)
  })
})

describe('month aggregation', () => {
  it('clamps per-user month sums at zero (fraud reversal of last month)', async () => {
    const uid = await mkUser('month')
    const now = new Date()
    await awardPoints(ctx(uid, now), { userId: uid, points: 4, reason: 'PLAY_TIME', idempotencyKey: 'mo:1' }, db)
    const { rows, totalValidPoints } = await monthPointsByUser(istMonthKey(now), db)
    const mine = rows.find((r) => r.userId === uid)
    expect(mine).toBeTruthy()
    expect(totalValidPoints).toBeGreaterThan(0)

    // reverse everything -> month sum clamps to 0, never negative
    const evs = await db.pointEvent.findMany({ where: { userId: uid, points: { gt: 0 } } })
    await voidEvents('admin-1', uid, evs.map((e) => e.id), 'test void', db)
    const after = await userMonthPoints(uid, istMonthKey(now), db)
    expect(after).toBeGreaterThanOrEqual(0)
  })
})

describe('pure helpers', () => {
  it('clampByDailyCap math', () => {
    expect(clampByDailyCap(0, 10, 10)).toBe(10)
    expect(clampByDailyCap(7, 10, 10)).toBe(3)
    expect(clampByDailyCap(10, 10, 10)).toBe(0)
    expect(clampByDailyCap(15, 10, 10)).toBe(0)
    expect(clampByDailyCap(5, 0, 10)).toBe(0)
  })
  it('streakAward scales and caps', () => {
    expect(streakAward(1, 5, 30)).toBe(5)
    expect(streakAward(2, 5, 30)).toBe(10)
    expect(streakAward(6, 5, 30)).toBe(30)
    expect(streakAward(30, 5, 30)).toBe(30)
    expect(streakAward(0, 5, 30)).toBe(0)
  })
})
