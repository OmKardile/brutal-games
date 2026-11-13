// Payout balances + month distribution building (shared by player summary
// and admin pool preview/lock).
//
// Balance model: points are NOT money. Money is credited only when a month's
// pool is LOCKED (PoolDistribution rows). A payout request reserves money:
//   available = Σ(locked distributions) − Σ(payouts not rejected)

import { db as defaultDb } from '@/lib/db'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { RewardSettings } from '@/lib/rewards/config'
import { monthPointsByUser, type DB } from '@/lib/rewards/points'
import { computeDistribution, type PoolComputation } from '@/lib/rewards/payout-math'
import { userRisk } from '@/lib/risk'

export interface BalanceInfo {
  creditedMinor: number
  reservedMinor: number
  availableMinor: number
}

type BalanceClient = Pick<PrismaClient, 'poolDistribution' | 'payoutRequest'>

export async function rewardBalance(userId: string, dbx: BalanceClient = defaultDb): Promise<BalanceInfo> {
  const creditedAgg = await dbx.poolDistribution.aggregate({
    where: { userId, pool: { status: 'LOCKED' } },
    _sum: { cappedShareMinor: true },
  })
  const reservedAgg = await dbx.payoutRequest.aggregate({
    where: { userId, status: { not: 'REJECTED' } },
    _sum: { amountMinor: true },
  })
  const creditedMinor = creditedAgg._sum.cappedShareMinor ?? 0
  const reservedMinor = reservedAgg._sum.amountMinor ?? 0
  return {
    creditedMinor,
    reservedMinor,
    availableMinor: Math.max(0, creditedMinor - reservedMinor),
  }
}

/** Build the full distribution computation for a month from the ledger. */
export async function buildMonthDistribution(
  monthKey: string,
  settings: RewardSettings,
  dbx: DB = defaultDb,
): Promise<PoolComputation & { netRevenueMinor: number; sharePercent: number }> {
  const pool = await dbx.monthlyPool.findUnique({ where: { month: monthKey } })
  const netRevenueMinor = pool?.netRevenueMinor ?? 0
  const sharePercent = pool?.sharePercent ?? settings.SHARE_PERCENT
  const { rows, totalValidPoints } = await monthPointsByUser(monthKey, dbx)
  const comp = computeDistribution(
    netRevenueMinor,
    sharePercent,
    settings.PAYOUT_CAP_MINOR,
    rows.map((r) => ({ userId: r.userId, points: r.points })),
  )
  return { ...comp, netRevenueMinor, sharePercent }
}

/** Lock a month inside one transaction. Idempotent-ish: rejects if locked. */
export async function lockMonth(
  adminId: string,
  monthKey: string,
  settings: RewardSettings,
  dbx: DB = defaultDb,
): Promise<{ ok: boolean; error?: string; computation?: PoolComputation }> {
  const pool = await dbx.monthlyPool.findUnique({ where: { month: monthKey } })
  if (!pool) return { ok: false, error: 'Enter the net revenue for this month first.' }
  if (pool.status === 'LOCKED') return { ok: false, error: 'This month is already locked.' }

  const comp = await buildMonthDistribution(monthKey, settings, dbx)
  if (comp.poolAmountMinor <= 0) {
    // zero revenue or zero points — locking is still allowed, payouts are 0
    void comp
  }

  try {
    await dbx.$transaction(async (tx) => {
      const distRows = comp.distributions.map((d) => ({
        poolId: pool.id,
        userId: d.userId,
        points: d.points,
        rawShareMinor: d.rawShareMinor,
        cappedShareMinor: d.cappedShareMinor,
        capped: d.capped,
      }))
      if (distRows.length) {
        await tx.poolDistribution.createMany({ data: distRows })
      }
      await tx.monthlyPool.update({
        where: { id: pool.id },
        data: {
          status: 'LOCKED',
          lockedAt: new Date(),
          poolAmountMinor: comp.poolAmountMinor,
          totalValidPoints: comp.totalValidPoints,
          leftoverMinor: comp.leftoverMinor,
        },
      })
    })
  } catch (err) {
    console.error('lockMonth failed', err)
    return { ok: false, error: 'Lock failed — check server logs.' }
  }
  return { ok: true, computation: comp }
}

export type PayoutRequestOutcome =
  | { ok: true; request: { id: string; amountMinor: number; holdUntil: Date } }
  | { ok: false; code: string; message: string }

export interface PayoutRequestDeps {
  user: {
    id: string
    status: string
    emailVerified: Date | null
    adultDeclaredAt: Date | null
    upiId: string | null
    createdAt: Date
  }
  settings: RewardSettings
  amountMinor: number
  /** client-supplied: a replayed key returns the original request (no double-reserve) */
  idempotencyKey?: string
}

/** Payout gating constants (phase 4, M6): documented, deliberately not admin-tunable. */
export const MIN_ACCOUNT_AGE_HOURS = 72
export const MIN_ACTIVE_DAYS = 3

export async function createPayoutRequest(
  deps: PayoutRequestDeps,
  dbx: DB = defaultDb,
): Promise<PayoutRequestOutcome> {
  const { user, settings } = deps
  if (user.status !== 'ACTIVE') return { ok: false, code: 'FROZEN', message: 'Account is frozen.' }
  if (!settings.REWARDS_ENABLED) {
    return { ok: false, code: 'DISABLED', message: 'Rewards are currently disabled.' }
  }
  // kill switch (phase 5): freezes money movement without touching the program
  if (settings.REWARDS_PAYOUTS_PAUSED) {
    return {
      ok: false,
      code: 'PAYOUTS_PAUSED',
      message: 'Payouts are temporarily paused. Your balance is safe — try again later.',
    }
  }
  if (!user.emailVerified) {
    return { ok: false, code: 'EMAIL_UNVERIFIED', message: 'Verify your email before requesting payouts.' }
  }
  if (!user.adultDeclaredAt) {
    return { ok: false, code: 'NO_CONSENT', message: '18+ declaration required.' }
  }
  if (!user.upiId) {
    return { ok: false, code: 'NO_UPI', message: 'Add a UPI ID first.' }
  }
  const upiId = user.upiId
  if (!Number.isInteger(deps.amountMinor) || deps.amountMinor <= 0) {
    return { ok: false, code: 'BAD_AMOUNT', message: 'Invalid amount.' }
  }
  if (deps.amountMinor < settings.MIN_PAYOUT_MINOR) {
    return {
      ok: false,
      code: 'BELOW_THRESHOLD',
      message: `Minimum payout is ₹${(settings.MIN_PAYOUT_MINOR / 100).toFixed(0)}. Your balance carries over.`,
    }
  }
  // ---- phase 4 gating (M6): make farmed accounts uneconomical ----------
  // 1. account age: fresh multi-accounts can't cash out immediately
  const ageHours = (Date.now() - user.createdAt.getTime()) / 3600_000
  if (ageHours < MIN_ACCOUNT_AGE_HOURS) {
    return {
      ok: false,
      code: 'ACCOUNT_TOO_NEW',
      message: `Accounts must be at least ${MIN_ACCOUNT_AGE_HOURS}h old before the first payout.`,
    }
  }
  // 2. distinct active days: real play history, not a burst farm
  const activeDays = await dbx.dailyActivity.count({ where: { userId: user.id } })
  if (activeDays < MIN_ACTIVE_DAYS) {
    return {
      ok: false,
      code: 'NEED_ACTIVITY',
      message: `Play on at least ${MIN_ACTIVE_DAYS} different days before your first payout.`,
    }
  }
  // 3. risk auto-HOLD: HIGH-risk accounts (explainable flag score) wait for
  //    review — never a ban; the appeal path is the flags queue + contact
  const risk = await userRisk(user.id, dbx)
  if (risk.level === 'HIGH') {
    return {
      ok: false,
      code: 'RISK_HOLD',
      message: 'Your account is under review — payouts are temporarily on hold. Contact support to appeal.',
    }
  }

  const holdUntil = new Date(Date.now() + settings.HOLD_PERIOD_DAYS * 24 * 3600_000)

  // ---- phase 5: transactional create (H8) — balance check + open-request
  // check + insert happen inside ONE transaction, so two concurrent requests
  // can never both pass the checks and double-reserve the balance.
  try {
    const created = await dbx.$transaction(async (tx) => {
      // idempotency first: a replayed key returns the original request
      if (deps.idempotencyKey) {
        const existing = await tx.payoutRequest.findUnique({
          where: { idempotencyKey: deps.idempotencyKey },
        })
        if (existing) return existing
      }
      const balance = await rewardBalance(user.id, tx)
      if (deps.amountMinor > balance.availableMinor) {
        throw Object.assign(new Error('INSUFFICIENT'), { code: 'INSUFFICIENT' })
      }
      const openCount = await tx.payoutRequest.count({
        where: { userId: user.id, status: { in: ['PENDING', 'APPROVED'] } },
      })
      if (openCount > 0) {
        throw Object.assign(new Error('ALREADY_PENDING'), { code: 'ALREADY_PENDING' })
      }
      return tx.payoutRequest.create({
        data: {
          userId: user.id,
          amountMinor: deps.amountMinor,
          upiId,
          holdUntil,
          ...(deps.idempotencyKey ? { idempotencyKey: deps.idempotencyKey } : {}),
        },
      })
    })
    return { ok: true, request: { id: created.id, amountMinor: created.amountMinor, holdUntil: created.holdUntil ?? holdUntil } }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'INSUFFICIENT') {
      return { ok: false, code, message: 'Amount exceeds your available balance.' }
    }
    if (code === 'ALREADY_PENDING') {
      return { ok: false, code, message: 'You already have a payout in progress.' }
    }
    // unique-constraint race on idempotencyKey: fetch and return the original
    if (deps.idempotencyKey) {
      const existing = await dbx.payoutRequest.findUnique({
        where: { idempotencyKey: deps.idempotencyKey },
      })
      if (existing) {
        return {
          ok: true,
          request: { id: existing.id, amountMinor: existing.amountMinor, holdUntil: existing.holdUntil ?? holdUntil },
        }
      }
    }
    console.error('createPayoutRequest failed', err)
    return { ok: false, code: 'FAILED', message: 'Could not create the request — try again.' }
  }
}

export const payoutInclude = {
  user: { select: { id: true, email: true, name: true, status: true, emailVerified: true } },
} satisfies Prisma.PayoutRequestInclude

// ------------------------------------------------ phase 5: admin payout actions

export type PayoutActionResult =
  | { ok: true; request: { id: string; status: string; approvedBy: string | null }; awaitingSecond?: boolean }
  | { ok: false; code: string; message: string }

/**
 * Approve a payout — TRANSACTIONAL, with the phase-5 integrity rules:
 * self-approval blocked, hold-period enforced, two-person rule above
 * TWO_PERSON_THRESHOLD_MINOR, in-tx status re-checks (no double-approve).
 */
export async function approvePayout(
  adminId: string,
  requestId: string,
  settings: RewardSettings,
  dbx: DB = defaultDb,
): Promise<PayoutActionResult> {
  if (settings.REWARDS_PAYOUTS_PAUSED) {
    return { ok: false, code: 'PAYOUTS_PAUSED', message: 'Payouts are paused (kill switch).' }
  }
  const request = await dbx.payoutRequest.findUnique({ where: { id: requestId } })
  if (!request) return { ok: false, code: 'NOT_FOUND', message: 'Not found.' }
  if (request.userId === adminId) {
    return {
      ok: false,
      code: 'SELF_APPROVAL',
      message: 'Self-approval is not allowed. Another admin must handle this payout.',
    }
  }
  try {
    const result = await dbx.$transaction(async (tx) => {
      const row = await tx.payoutRequest.findUnique({ where: { id: requestId } })
      if (!row || row.status !== 'PENDING') {
        throw Object.assign(new Error('Only PENDING requests can be approved.'), { code: 'STATUS' })
      }
      if (row.holdUntil && row.holdUntil.getTime() > Date.now()) {
        throw Object.assign(new Error(`Hold period active until ${row.holdUntil.toISOString()}.`), { code: 'HOLD' })
      }
      const threshold = settings.TWO_PERSON_THRESHOLD_MINOR
      if (threshold > 0 && row.amountMinor >= threshold) {
        if (!row.approvedBy) {
          const first = await tx.payoutRequest.update({
            where: { id: row.id },
            data: { approvedBy: adminId },
          })
          return { request: first, awaitingSecond: true }
        }
        if (row.approvedBy === adminId) {
          throw Object.assign(
            new Error('Two-person rule: a DIFFERENT admin must finalize this payout.'),
            { code: 'TWO_PERSON' },
          )
        }
      }
      return {
        request: await tx.payoutRequest.update({
          where: { id: row.id },
          data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
        }),
        awaitingSecond: false,
      }
    })
    return {
      ok: true,
      request: { id: result.request.id, status: result.request.status, approvedBy: result.request.approvedBy },
      ...(result.awaitingSecond ? { awaitingSecond: true } : {}),
    }
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code ?? 'FAILED', message: (err as Error).message }
  }
}

/** Reject a payout (works while paused — rejecting frees money). */
export async function rejectPayout(
  adminId: string,
  requestId: string,
  reason: string,
  dbx: DB = defaultDb,
): Promise<PayoutActionResult> {
  try {
    const row = await dbx.$transaction(async (tx) => {
      const existing = await tx.payoutRequest.findUnique({ where: { id: requestId } })
      if (!existing || (existing.status !== 'PENDING' && existing.status !== 'APPROVED')) {
        throw Object.assign(new Error('Only PENDING/APPROVED requests can be rejected.'), { code: 'STATUS' })
      }
      return tx.payoutRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          rejectedReason: reason,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      })
    })
    // freed money returns to the pool's voided counter (stays unpaid)
    await dbx.monthlyPool
      .updateMany({
        where: { status: 'LOCKED', distributions: { some: { userId: row.userId } } },
        data: { voidedMinor: { increment: row.amountMinor } },
      })
      .catch(() => undefined)
    return { ok: true, request: { id: row.id, status: row.status, approvedBy: row.approvedBy } }
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code ?? 'FAILED', message: (err as Error).message }
  }
}

/** Mark an APPROVED payout as paid (transaction reference required). */
export async function markPayoutPaid(
  adminId: string,
  requestId: string,
  transactionRef: string,
  settings: RewardSettings,
  dbx: DB = defaultDb,
): Promise<PayoutActionResult> {
  if (settings.REWARDS_PAYOUTS_PAUSED) {
    return { ok: false, code: 'PAYOUTS_PAUSED', message: 'Payouts are paused (kill switch).' }
  }
  try {
    const row = await dbx.$transaction(async (tx) => {
      const existing = await tx.payoutRequest.findUnique({ where: { id: requestId } })
      if (!existing || existing.status !== 'APPROVED') {
        throw Object.assign(new Error('Only APPROVED requests can be marked paid.'), { code: 'STATUS' })
      }
      return tx.payoutRequest.update({
        where: { id: requestId },
        data: { status: 'PAID', paidAt: new Date(), transactionRef },
      })
    })
    return { ok: true, request: { id: row.id, status: row.status, approvedBy: row.approvedBy } }
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code ?? 'FAILED', message: (err as Error).message }
  }
}
