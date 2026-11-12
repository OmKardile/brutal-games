// Payout balances + month distribution building (shared by player summary
// and admin pool preview/lock).
//
// Balance model: points are NOT money. Money is credited only when a month's
// pool is LOCKED (PoolDistribution rows). A payout request reserves money:
//   available = Σ(locked distributions) − Σ(payouts not rejected)

import { db as defaultDb } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import type { RewardSettings } from '@/lib/rewards/config'
import { monthPointsByUser, type DB } from '@/lib/rewards/points'
import { computeDistribution, type PoolComputation } from '@/lib/rewards/payout-math'

export interface BalanceInfo {
  creditedMinor: number
  reservedMinor: number
  availableMinor: number
}

export async function rewardBalance(userId: string, dbx: DB = defaultDb): Promise<BalanceInfo> {
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
  }
  settings: RewardSettings
  amountMinor: number
}

export async function createPayoutRequest(
  deps: PayoutRequestDeps,
  dbx: DB = defaultDb,
): Promise<PayoutRequestOutcome> {
  const { user, settings } = deps
  if (user.status !== 'ACTIVE') return { ok: false, code: 'FROZEN', message: 'Account is frozen.' }
  if (!user.emailVerified) {
    return { ok: false, code: 'EMAIL_UNVERIFIED', message: 'Verify your email before requesting payouts.' }
  }
  if (!user.adultDeclaredAt) {
    return { ok: false, code: 'NO_CONSENT', message: '18+ declaration required.' }
  }
  if (!user.upiId) {
    return { ok: false, code: 'NO_UPI', message: 'Add a UPI ID first.' }
  }
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
  const balance = await rewardBalance(user.id, dbx)
  if (deps.amountMinor > balance.availableMinor) {
    return { ok: false, code: 'INSUFFICIENT', message: 'Amount exceeds your available balance.' }
  }
  const openCount = await dbx.payoutRequest.count({
    where: { userId: user.id, status: { in: ['PENDING', 'APPROVED'] } },
  })
  if (openCount > 0) {
    return { ok: false, code: 'ALREADY_PENDING', message: 'You already have a payout in progress.' }
  }

  const holdUntil = new Date(Date.now() + settings.HOLD_PERIOD_DAYS * 24 * 3600_000)
  const created = await dbx.payoutRequest.create({
    data: {
      userId: user.id,
      amountMinor: deps.amountMinor,
      upiId: user.upiId,
      holdUntil,
    },
  })
  return { ok: true, request: { id: created.id, amountMinor: created.amountMinor, holdUntil } }
}

export const payoutInclude = {
  user: { select: { id: true, email: true, name: true, status: true, emailVerified: true } },
} satisfies Prisma.PayoutRequestInclude
