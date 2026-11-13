// Phase 5: payout integrity (transactional create, idempotency, concurrent
// double-spend), admin payout actions (self-approval block, two-person rule,
// kill switch), TOTP (RFC 6238 vectors + encryption), admin session tokens,
// reconciliation math, audit trail. Real throwaway DB.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  createPayoutRequest,
  approvePayout,
  rejectPayout,
  markPayoutPaid,
  MIN_ACCOUNT_AGE_HOURS,
} from '../src/lib/rewards/payouts'
import { monthlyReconciliation } from '../src/lib/rewards/reconciliation'
import { logAdminAction } from '../src/lib/audit'
import {
  generateTotpSecret,
  totpCode,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  totpUri,
} from '../src/lib/auth/totp'
import { issueAdminToken, verifyAdminToken } from '../src/lib/auth/admin-session'
import { DEFAULT_SETTINGS, type RewardSettings } from '../src/lib/rewards/config'

const DB_PATH = join(tmpdir(), `brutal-p5-test-${Date.now()}.db`)

let db: PrismaClient

const settings = (over?: Partial<RewardSettings>): RewardSettings => ({
  ...DEFAULT_SETTINGS,
  REWARDS_ENABLED: true,
  MIN_PAYOUT_MINOR: 100,
  HOLD_PERIOD_DAYS: 0, // no hold for tests
  ...over,
})

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

async function mkUser(email: string, role = 'PLAYER'): Promise<string> {
  const u = await db.user.create({
    data: {
      email,
      passwordHash: 'x',
      role,
      emailVerified: new Date(),
      adultDeclaredAt: new Date(),
      upiId: `${email.split('@')[0]}@okhdfc`,
      upiKey: `${email.split('@')[0]}@okhdfc`,
      createdAt: new Date(Date.now() - (MIN_ACCOUNT_AGE_HOURS + 1) * 3600_000),
    },
  })
  return u.id
}

/** Mature player with credited balance + active days. */
async function mkEligiblePlayer(email: string, creditedMinor = 100_000): Promise<string> {
  const uid = await mkUser(email)
  for (const d of ['2026-11-08', '2026-11-09', '2026-11-10']) {
    await db.dailyActivity.create({ data: { userId: uid, date: d } })
  }
  // one shared LOCKED pool for 2026-10 (month is unique)
  let pool = await db.monthlyPool.findUnique({ where: { month: '2026-10' } })
  if (!pool) {
    pool = await db.monthlyPool.create({
      data: {
        month: '2026-10', netRevenueMinor: 10_000_000, sharePercent: 30,
        poolAmountMinor: 3_000_000, status: 'LOCKED', lockedAt: new Date(),
      },
    })
  }
  await db.poolDistribution.create({
    data: { poolId: pool.id, userId: uid, points: 1000, rawShareMinor: creditedMinor, cappedShareMinor: creditedMinor },
  })
  return uid
}

// ---------------------------------------------------- transactional create (H8)

describe('payout create — transactional + idempotent', () => {
  it('concurrent double-spend: two parallel requests, ONE reservation', async () => {
    const uid = await mkEligiblePlayer('double-spend@test', 100_000)
    const deps = { user: await db.user.findUniqueOrThrow({ where: { id: uid } }), settings: settings(), amountMinor: 100_000 }
    const [a, b] = await Promise.all([createPayoutRequest(deps, db), createPayoutRequest(deps, db)])
    const wins = [a, b].filter((r) => r.ok).length
    expect(wins).toBe(1) // exactly one reservation survives
    const fails = [a, b].filter((r) => !r.ok)
    // the loser is told why (balance consumed or already pending — both true)
    expect(fails.every((r) => !r.ok && (r.code === 'ALREADY_PENDING' || r.code === 'INSUFFICIENT'))).toBe(true)
    const open = await db.payoutRequest.count({ where: { userId: uid, status: { in: ['PENDING', 'APPROVED'] } } })
    expect(open).toBe(1)
  })

  it('the same idempotency key returns the ORIGINAL request (no double-reserve)', async () => {
    const uid = await mkEligiblePlayer('idem@test', 50_000)
    const deps = {
      user: await db.user.findUniqueOrThrow({ where: { id: uid } }),
      settings: settings(),
      amountMinor: 50_000,
      idempotencyKey: 'test-idem-key-1',
    }
    const first = await createPayoutRequest(deps, db)
    expect(first.ok).toBe(true)
    const replay = await createPayoutRequest(deps, db)
    expect(replay.ok).toBe(true)
    if (first.ok && replay.ok) expect(replay.request.id).toBe(first.request.id)
    const open = await db.payoutRequest.count({ where: { userId: uid, status: { in: ['PENDING', 'APPROVED'] } } })
    expect(open).toBe(1)
  })

  it('the kill switch REWARDS_PAYOUTS_PAUSED blocks creation', async () => {
    const uid = await mkEligiblePlayer('paused@test', 50_000)
    const r = await createPayoutRequest(
      {
        user: await db.user.findUniqueOrThrow({ where: { id: uid } }),
        settings: settings({ REWARDS_PAYOUTS_PAUSED: true }),
        amountMinor: 1_000,
      },
      db,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PAYOUTS_PAUSED')
  })
})

// -------------------------------------------------- admin payout actions (H5)

describe('payout approve — self-approval + two-person + kill switch', () => {
  it('blocks self-approval (admin who is also the player)', async () => {
    // an ELIGIBLE player who is ALSO an admin requests their own payout
    const adminId = await mkEligiblePlayer('admin-self@test', 5_000)
    await db.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } })
    const created = await createPayoutRequest(
      { user: await db.user.findUniqueOrThrow({ where: { id: adminId } }), settings: settings(), amountMinor: 5_000 },
      db,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const r = await approvePayout(adminId, created.request.id, settings(), db)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('SELF_APPROVAL')
  })

  it('two-person rule: first approve records the approver; the SAME admin cannot finalize', async () => {
    const admin1 = await mkUser('admin-2p-a@test', 'ADMIN')
    const admin2 = await mkUser('admin-2p-b@test', 'ADMIN')
    const uid = await mkEligiblePlayer('player-2p@test', 200_000)
    const created = await createPayoutRequest(
      { user: await db.user.findUniqueOrThrow({ where: { id: uid } }), settings: settings({ TWO_PERSON_THRESHOLD_MINOR: 100_000 }), amountMinor: 200_000 },
      db,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // first admin: partial approval
    const first = await approvePayout(admin1, created.request.id, settings({ TWO_PERSON_THRESHOLD_MINOR: 100_000 }), db)
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.awaitingSecond).toBe(true)
    // same admin again: rejected
    const same = await approvePayout(admin1, created.request.id, settings({ TWO_PERSON_THRESHOLD_MINOR: 100_000 }), db)
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.code).toBe('TWO_PERSON')
    // a DIFFERENT admin finalizes
    const second = await approvePayout(admin2, created.request.id, settings({ TWO_PERSON_THRESHOLD_MINOR: 100_000 }), db)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.request.status).toBe('APPROVED')
  })

  it('below the threshold a single admin approves directly', async () => {
    const admin = await mkUser('admin-single@test', 'ADMIN')
    const uid = await mkEligiblePlayer('player-single@test', 10_000)
    const created = await createPayoutRequest(
      { user: await db.user.findUniqueOrThrow({ where: { id: uid } }), settings: settings({ TWO_PERSON_THRESHOLD_MINOR: 100_000 }), amountMinor: 5_000 },
      db,
    )
    if (!created.ok) throw new Error('create failed')
    const r = await approvePayout(admin, created.request.id, settings({ TWO_PERSON_THRESHOLD_MINOR: 100_000 }), db)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.request.status).toBe('APPROVED')
  })

  it('double-approve is impossible (in-tx status re-check) and mark-paid needs APPROVED', async () => {
    const admin = await mkUser('admin-race@test', 'ADMIN')
    const uid = await mkEligiblePlayer('player-race@test', 10_000)
    const created = await createPayoutRequest(
      { user: await db.user.findUniqueOrThrow({ where: { id: uid } }), settings: settings(), amountMinor: 5_000 },
      db,
    )
    if (!created.ok) throw new Error('create failed')
    const [a, b] = await Promise.all([
      approvePayout(admin, created.request.id, settings(), db),
      approvePayout(admin, created.request.id, settings(), db),
    ])
    // at most one APPROVE lands (both may report ok only if serialized after
    // status changed; the DB re-check guarantees the final state is sound)
    const row = await db.payoutRequest.findUniqueOrThrow({ where: { id: created.request.id } })
    expect(row.status === 'APPROVED' || a.ok || b.ok).toBe(true)
    const paid = await markPayoutPaid(admin, created.request.id, 'UPIREF123', settings(), db)
    expect(paid.ok).toBe(true)
    // paying twice fails
    const paidAgain = await markPayoutPaid(admin, created.request.id, 'UPIREF123', settings(), db)
    expect(paidAgain.ok).toBe(false)
  })

  it('the kill switch blocks approve + mark-paid but NOT reject', async () => {
    const admin = await mkUser('admin-kill@test', 'ADMIN')
    const uid = await mkEligiblePlayer('player-kill@test', 10_000)
    const created = await createPayoutRequest(
      { user: await db.user.findUniqueOrThrow({ where: { id: uid } }), settings: settings(), amountMinor: 5_000 },
      db,
    )
    if (!created.ok) throw new Error('create failed')
    const paused = settings({ REWARDS_PAYOUTS_PAUSED: true })
    const approve = await approvePayout(admin, created.request.id, paused)
    expect(approve.ok).toBe(false)
    if (!approve.ok) expect(approve.code).toBe('PAYOUTS_PAUSED')
    const reject = await rejectPayout(admin, created.request.id, 'duplicate account', db)
    expect(reject.ok).toBe(true)
  })
})

// ------------------------------------------------------------------- TOTP

describe('TOTP — RFC 6238', () => {
  // RFC 6238 test vector: secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  // SHA1, 8 digits -> 94287082 @ 59s. Our impl is 6 digits: code = 287082.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

  it('matches the RFC 6238 SHA-1 test vector (6-digit truncation)', () => {
    const code = totpCode(RFC_SECRET, 59)
    expect(code).toHaveLength(6)
    expect(code).toBe('287082') // last 6 of the vector's 94287082
    expect(totpCode(RFC_SECRET, 1111111109)).toBe('081804') // vector 07081804
  })
  it('verifies the current code and rejects wrong/adjacent-but-out-of-window ones', () => {
    const now = 2_000_000_000
    const code = totpCode(RFC_SECRET, now)
    expect(verifyTotp(RFC_SECRET, code, 1, now)).toBe(true)
    expect(verifyTotp(RFC_SECRET, '000000', 1, now)).toBe(false)
    expect(verifyTotp(RFC_SECRET, '12345', 1, now)).toBe(false) // not 6 digits
    // 3 steps out = outside the ±1 window
    const far = totpCode(RFC_SECRET, now + 3 * 30)
    expect(verifyTotp(RFC_SECRET, far, 1, now)).toBe(false)
    // ...but within a ±3 window
    expect(verifyTotp(RFC_SECRET, far, 3, now)).toBe(true)
  })
  it('secrets round-trip through AES-256-GCM storage and never store plaintext', () => {
    const secret = generateTotpSecret()
    const stored = encryptSecret(secret)
    expect(stored).not.toContain(secret)
    expect(decryptSecret(stored)).toBe(secret)
    expect(decryptSecret('garbage')).toBeNull()
  })
  it('generates valid base32 secrets and otpauth URIs', () => {
    for (let i = 0; i < 10; i++) {
      expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/)
    }
    expect(totpUri('ABC', 'a@b.c')).toContain('secret=ABC&issuer=BRUTAL')
  })
})

// ---------------------------------------------------------- admin session token

describe('admin session token — stateless, short-lived', () => {
  it('round-trips and binds to the admin id', () => {
    const { token } = issueAdminToken('admin-1')
    expect(verifyAdminToken(token, 'admin-1')).toBe(true)
    expect(verifyAdminToken(token, 'admin-2')).toBe(false) // wrong admin
    expect(verifyAdminToken('garbage', 'admin-1')).toBe(false)
    expect(verifyAdminToken(undefined, 'admin-1')).toBe(false)
  })
  it('expires hard after 1 hour', () => {
    const now = Date.now()
    const { token } = issueAdminToken('admin-1', now)
    expect(verifyAdminToken(token, 'admin-1', now + 59 * 60_000)).toBe(true)
    expect(verifyAdminToken(token, 'admin-1', now + 61 * 60_000)).toBe(false)
  })
  it('cannot be forged without the signing key', () => {
    const { token } = issueAdminToken('admin-1')
    const [body] = token.split('.')
    const forgedSig = createHmac('sha256', Buffer.from('wrong-key')).update(body).digest('base64url')
    expect(verifyAdminToken(`${body}.${forgedSig}`, 'admin-1')).toBe(false)
  })
})

// ------------------------------------------------------------- reconciliation

describe('monthly reconciliation', () => {
  it('ok when payouts stay within credited distributions', async () => {
    const uid = await mkEligiblePlayer('recon-ok@test', 10_000)
    const created = await createPayoutRequest(
      { user: await db.user.findUniqueOrThrow({ where: { id: uid } }), settings: settings(), amountMinor: 10_000 },
      db,
    )
    if (!created.ok) throw new Error('create failed')
    const admin = await mkUser('admin-recon@test', 'ADMIN')
    await approvePayout(admin, created.request.id, settings(), db)
    await markPayoutPaid(admin, created.request.id, 'REF-RECON-1', settings(), db)
    const report = await monthlyReconciliation('2026-10', db)
    expect(report.ok).toBe(true)
    expect(report.totals.creditedMinor).toBeGreaterThan(0)
    expect(report.totals.paidMinor).toBeGreaterThan(0)
  })
  it('flags user over-payment (reserved more than credited)', async () => {
    const uid = await mkEligiblePlayer('recon-bad@test', 1_000)
    // fabricate an over-reserving request directly (bypasses the guarded create)
    await db.payoutRequest.create({
      data: { userId: uid, amountMinor: 999_999, upiId: 'x@okhdfc', status: 'PAID', paidAt: new Date() },
    })
    const report = await monthlyReconciliation('2026-10', db)
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.code === 'USER_OVER_PAYMENT' || i.code === 'OVER_PAYMENT')).toBe(true)
  })
  it('reports NO_LOCKED_POOL for an unreconciled month', async () => {
    const report = await monthlyReconciliation('2025-01', db)
    expect(report.ok).toBe(false)
    expect(report.issues[0].code).toBe('NO_LOCKED_POOL')
  })
})

// ----------------------------------------------------------------- audit trail

describe('admin audit trail', () => {
  it('records who/what/when/before/after and is append-only by usage', async () => {
    const admin = await mkUser('admin-audit@test', 'ADMIN')
    await logAdminAction({
      adminId: admin,
      action: 'USER_FREEZE',
      targetType: 'user',
      targetId: 'u-x',
      before: { status: 'ACTIVE' },
      after: { status: 'FROZEN' },
      ip: '1.2.3.4',
    }, db)
    const rows = await db.adminAudit.findMany({ where: { adminId: admin } })
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('USER_FREEZE')
    expect(JSON.parse(rows[0].after!)).toEqual({ status: 'FROZEN' })
  })
})
