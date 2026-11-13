// Phase 4: risk scoring (explainable bands), pending verification + board
// moderation, UPI destination uniqueness, new-account cooling, payout gating,
// privacy (HMAC fingerprints + hashed IPs). Against a real throwaway DB.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { scoreFromFlags, userRisk, hasConfirmedFraud } from '../src/lib/risk'
import { recordScore, rankedBoard, releaseStalePending } from '../src/lib/scores/service'
import { flagUser, fingerprintOf, ipHash } from '../src/lib/rewards/fraud'
import { createPayoutRequest, MIN_ACCOUNT_AGE_HOURS, MIN_ACTIVE_DAYS } from '../src/lib/rewards/payouts'
import { awardPoints, COOLING_HOURS, type AwardContext } from '../src/lib/rewards/points'
import { signRunToken } from '../src/lib/run-token'
import { DEFAULT_SETTINGS, type RewardSettings } from '../src/lib/rewards/config'

const DB_PATH = join(tmpdir(), `brutal-p4-test-${Date.now()}.db`)

let db: PrismaClient

const settings = (): RewardSettings => ({ ...DEFAULT_SETTINGS, REWARDS_ENABLED: true })

/** Sign a token AND create its PlaySession row (backdated start). */
async function mkRun(userId: string, game: string, startedAgoSec: number): Promise<string> {
  const startedAt = Date.now() - startedAgoSec * 1000
  const token = signRunToken({ uid: userId, game, seed: null, startedAt })
  await db.playSession.create({
    data: {
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      game,
      startedAt: new Date(startedAt),
      ip: 'test',
      challenge: 'test-challenge',
    },
  })
  return token
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
  db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
})

afterAll(async () => {
  await db?.$disconnect().catch(() => undefined)
  rmSync(DB_PATH, { force: true })
  rmSync(DB_PATH + '-journal', { force: true })
})

async function mkUser(email: string, opts?: { createdAt?: Date }): Promise<string> {
  const u = await db.user.create({
    data: { email, passwordHash: 'x', ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}) },
  })
  return u.id
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ------------------------------------------------------------------- risk score

describe('risk scoring — explainable bands', () => {
  it('LOW for clean or trivial signals', () => {
    expect(scoreFromFlags([]).level).toBe('LOW')
    expect(scoreFromFlags([{ type: 'ANOMALY', severity: 'LOW', status: 'OPEN' }]).level).toBe('LOW')
  })
  it('MEDIUM for a couple of review-worthy signals', () => {
    const r = scoreFromFlags([
      { type: 'DUPLICATE_DEVICE', severity: 'MEDIUM', status: 'OPEN' },
      { type: 'ANOMALY', severity: 'MEDIUM', status: 'OPEN' },
    ])
    expect(r.level).toBe('MEDIUM')
    expect(r.score).toBe(20)
    expect(r.reasons.map((x) => x.code)).toContain('DUPLICATE_DEVICE')
  })
  it('HIGH band engages the auto-HOLD (never a ban)', () => {
    const r = scoreFromFlags([
      { type: 'VPN_DATACENTER', severity: 'HIGH', status: 'OPEN' },
      { type: 'HEADLESS_SUSPECT', severity: 'HIGH', status: 'OPEN' },
    ])
    expect(r.score).toBe(50)
    expect(r.level).toBe('HIGH')
  })
  it('confirmed flags weigh double; dismissed flags vanish', () => {
    const r = scoreFromFlags([
      { type: 'ANOMALY', severity: 'MEDIUM', status: 'CONFIRMED' }, // 20
      { type: 'DUPLICATE_IP', severity: 'MEDIUM', status: 'DISMISSED' }, // 0
    ])
    expect(r.score).toBe(20)
    expect(r.reasons).toHaveLength(1)
  })
  it('one reason per type keeps the heaviest', () => {
    const r = scoreFromFlags([
      { type: 'ANOMALY', severity: 'LOW', status: 'OPEN' }, // 3
      { type: 'ANOMALY', severity: 'MEDIUM', status: 'CONFIRMED' }, // 20
    ])
    expect(r.reasons).toHaveLength(1)
    expect(r.reasons[0].points).toBe(20)
  })
})

// ------------------------------------------------- pending verification + moderation

describe('pending verification + board moderation', () => {
  async function seedVerifiedRow(game: string, score: number): Promise<void> {
    await db.highScore.create({
      data: { name: `SEED-${score}`, score, wave: 1, kills: 1, game, ranked: true, pending: false },
    })
  }

  it('a top-3 entry lands pending; the board hides it until verified', async () => {
    const uid = await mkUser('pending-top@test')
    const token = await mkRun(uid, 'dodge', 90)
    // dodge ceiling: 30 pts/s -> a 90s run tops out at ~2850; keep plausible
    const res = await recordScore(
      { userId: uid, game: 'dodge', score: 2_000, wave: 3, kills: 30, runToken: token },
      db,
    )
    expect(res.kind === 'ok' && res.pending).toBe(true)
    // hidden from the board while pending
    expect((await rankedBoard('dodge', db)).some((e) => e.score === 2_000)).toBe(false)
    // admin verify -> visible
    const row = await db.highScore.findFirst({ where: { userId: uid, game: 'dodge' } })
    await db.highScore.update({ where: { id: row!.id }, data: { pending: false } })
    expect((await rankedBoard('dodge', db)).some((e) => e.score === 2_000)).toBe(true)
  })

  it('a mid-board entry skips pending entirely', async () => {
    for (const s of [10_000, 9_500, 9_200]) await seedVerifiedRow('merge', s)
    const uid = await mkUser('pending-mid@test')
    const token = await mkRun(uid, 'merge', 90)
    const res = await recordScore(
      { userId: uid, game: 'merge', score: 5_000, wave: 2, kills: 10, runToken: token },
      db,
    )
    expect(res.kind === 'ok' && res.pending).toBe(false)
    expect(res.kind === 'ok' && res.rank).toBe(4)
  })

  it('HIGH-risk authors always land pending; confirmed-fraud authors never rank', async () => {
    const risky = await mkUser('risky@test')
    await flagUser(risky, 'VPN_DATACENTER', 'HIGH', {}, db)
    await flagUser(risky, 'HEADLESS_SUSPECT', 'HIGH', {}, db)
    expect((await userRisk(risky, db)).level).toBe('HIGH')

    const token = await mkRun(risky, 'reflex', 60)
    // seed three verified rows so it would NOT be top-3 otherwise
    for (const s of [50_000, 49_000, 48_000]) await seedVerifiedRow('reflex', s)
    const res = await recordScore(
      { userId: risky, game: 'reflex', score: 100, wave: 1, kills: 5, runToken: token },
      db,
    )
    expect(res.kind === 'ok' && res.pending).toBe(true)

    // adjudicated cheater: CONFIRMED flag forces display-only forever
    const cheater = await mkUser('cheater@test')
    await flagUser(cheater, 'ANOMALY', 'HIGH', {}, db)
    await db.fraudFlag.updateMany({ where: { userId: cheater }, data: { status: 'CONFIRMED' } })
    expect(await hasConfirmedFraud(cheater, db)).toBe(true)
    const token2 = await mkRun(cheater, 'reflex', 60)
    const res2 = await recordScore(
      { userId: cheater, game: 'reflex', score: 100, wave: 1, kills: 5, runToken: token2 },
      db,
    )
    expect(res2.kind === 'ok' && res2.ranked).toBe(false)
    expect(res2.kind === 'ok' && res2.rankReason).toBe('CONFIRMED_FRAUD')
  })

  it('removed entries never render; ranks recompute on read', async () => {
    for (const s of [7_000, 6_000]) await seedVerifiedRow('stack', s)
    const board1 = await rankedBoard('stack', db)
    expect(board1.length).toBeGreaterThanOrEqual(2)
    // remove the top entry (moderation)
    await db.highScore.update({
      where: { id: board1[0].id },
      data: { removedAt: new Date(), removedBy: 'admin', removedReason: 'test removal' },
    })
    const board2 = await rankedBoard('stack', db)
    expect(board2.some((e) => e.id === board1[0].id)).toBe(false)
    expect(board2[0].score).toBe(6_000)
  })

  it('stale pending entries auto-release for LOW-risk authors', async () => {
    const uid = await mkUser('stale-pending@test')
    const row = await db.highScore.create({
      data: {
        name: 'STALE', score: 1, wave: 1, kills: 1, game: 'arena',
        userId: uid, ranked: true, pending: true,
        createdAt: new Date(Date.now() - 30 * 3600_000),
      },
    })
    const released = await releaseStalePending(db, new Date(Date.now() + 60_000))
    expect(released).toBeGreaterThanOrEqual(1)
    const after = await db.highScore.findUnique({ where: { id: row.id } })
    expect(after?.pending).toBe(false)
  })
})

// ------------------------------------------------------------------------- UPI

describe('UPI destination uniqueness', () => {
  it('normalized upiKey is unique across accounts (constraint)', async () => {
    const a = await mkUser('upi-a@test')
    await db.user.update({ where: { id: a }, data: { upiId: 'Player@OKHDFC', upiKey: 'player@okhdfc' } })
    const b = await mkUser('upi-b@test')
    let threw = false
    try {
      await db.user.update({ where: { id: b }, data: { upiId: 'player@OKHDFC', upiKey: 'player@okhdfc' } })
    } catch {
      threw = true // unique constraint violated — exactly what we want
    }
    expect(threw).toBe(true)
  })
})

// --------------------------------------------------------------------- cooling

describe('new-account cooling (halved daily cap)', () => {
  const ctx = (uid: string, createdAt: Date): AwardContext => ({
    settings: { ...settings(), DAILY_POINT_CAP: 100, HEARTBEAT_POINTS: 1 },
    user: { id: uid, status: 'ACTIVE', adultDeclaredAt: new Date(), createdAt },
  })

  it('young accounts clamp at half the cap', async () => {
    const uid = await mkUser('cooling-young@test')
    for (let i = 0; i < 60; i++) {
      await awardPoints(ctx(uid, new Date()), {
        userId: uid, points: 1, reason: 'PLAY_TIME', idempotencyKey: `cool:y:${i}`,
      }, db)
    }
    // day total (play + login streak) clamped at 100 * 0.5
    const act = await db.dailyActivity.findFirst({ where: { userId: uid } })
    expect(act?.pointsEarned).toBe(50)
  })
  it('accounts older than the cooling window earn the full cap', async () => {
    const oldCreated = new Date(Date.now() - (COOLING_HOURS + 1) * 3600_000)
    const uid = await mkUser('cooling-old@test', { createdAt: oldCreated })
    for (let i = 0; i < 110; i++) {
      await awardPoints(ctx(uid, oldCreated), {
        userId: uid, points: 1, reason: 'PLAY_TIME', idempotencyKey: `cool:o:${i}`,
      }, db)
    }
    const act = await db.dailyActivity.findFirst({ where: { userId: uid } })
    expect(act?.pointsEarned).toBe(100)
  })
})

// --------------------------------------------------------------- payout gating

describe('payout gating (account age / active days / risk hold)', () => {
  const baseUser = (uid: string, createdAt: Date) => ({
    id: uid,
    status: 'ACTIVE',
    emailVerified: new Date(),
    adultDeclaredAt: new Date(),
    upiId: 'pay@okhdfc',
    createdAt,
  })

  it('rejects accounts younger than 72h', async () => {
    const uid = await mkUser('gate-young@test')
    const r = await createPayoutRequest(
      { user: baseUser(uid, new Date()), settings: { ...settings(), MIN_PAYOUT_MINOR: 100 }, amountMinor: 500 },
      db,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('ACCOUNT_TOO_NEW')
  })

  it('rejects accounts without 3 distinct active days', async () => {
    const uid = await mkUser('gate-days@test', { createdAt: new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000) })
    await db.dailyActivity.create({ data: { userId: uid, date: '2026-11-12' } })
    const r = await createPayoutRequest(
      { user: baseUser(uid, new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000)), settings: { ...settings(), MIN_PAYOUT_MINOR: 100 }, amountMinor: 500 },
      db,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NEED_ACTIVITY')
  })

  it('holds HIGH-risk accounts (auto-HOLD, appealable — never a ban)', async () => {
    const uid = await mkUser('gate-risk@test', { createdAt: new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000) })
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) {
      await db.dailyActivity.create({ data: { userId: uid, date: d } })
    }
    await flagUser(uid, 'VPN_DATACENTER', 'HIGH', {}, db)
    await flagUser(uid, 'HEADLESS_SUSPECT', 'HIGH', {}, db)
    const r = await createPayoutRequest(
      { user: baseUser(uid, new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000)), settings: { ...settings(), MIN_PAYOUT_MINOR: 100 }, amountMinor: 500 },
      db,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('RISK_HOLD')
  })

  it('accepts a mature, active, low-risk account with balance', async () => {
    const uid = await mkUser('gate-ok@test', { createdAt: new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000) })
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) {
      await db.dailyActivity.create({ data: { userId: uid, date: d } })
    }
    // give the account a locked-pool balance of ₹10
    const pool = await db.monthlyPool.create({
      data: { month: '2026-10', netRevenueMinor: 100_000, sharePercent: 30, poolAmountMinor: 30_000, status: 'LOCKED', lockedAt: new Date() },
    })
    await db.poolDistribution.create({
      data: { poolId: pool.id, userId: uid, points: 100, rawShareMinor: 1000, cappedShareMinor: 1000 },
    })
    const r = await createPayoutRequest(
      { user: baseUser(uid, new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000)), settings: { ...settings(), MIN_PAYOUT_MINOR: 100 }, amountMinor: 500 },
      db,
    )
    expect(r.ok).toBe(true)
  })
})

// -------------------------------------------------------------------- privacy

describe('privacy — HMAC fingerprints + hashed IPs', () => {
  it('fingerprints are salted (not plain sha256 of signals)', () => {
    const signals = { userAgent: 'Mozilla/5.0 Test', language: 'en', platform: 'win' }
    const fp = fingerprintOf(signals)
    expect(fp).not.toBe(sha256(JSON.stringify(signals))) // keyed, not plain
    expect(fp).toBe(fingerprintOf(signals)) // deterministic for clustering
    expect(fp).not.toBe(fingerprintOf({ ...signals, language: 'de' }))
  })
  it('IP hashes are deterministic + not the raw IP', () => {
    expect(ipHash('1.2.3.4')).not.toBe('1.2.3.4')
    expect(ipHash('1.2.3.4')).toBe(ipHash('1.2.3.4'))
    expect(ipHash('1.2.3.4')).not.toBe(ipHash('1.2.3.5'))
  })
})
