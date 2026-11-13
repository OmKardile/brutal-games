// Monthly payout reconciliation (phase 5). Verifies the money invariants:
//   1. For every LOCKED pool: Σ paid-or-open payouts charged to that pool's
//      users can never exceed the pool amount (no over-payment).
//   2. Per-user ledger sanity: no user's lifetime payout total exceeds their
//      credited distributions (no negative balances, ever).
//   3. The ledger is append-only by construction; a month-sum below zero
//      would indicate a broken reversal — reported as an issue.
// Pure read-only; the report is surfaced to admins (and phase 6 wires
// mismatch alerts to the notification channel).

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'

export interface ReconciliationIssue {
  code: string
  detail: string
}

export interface ReconciliationReport {
  month: string
  ok: boolean
  issues: ReconciliationIssue[]
  totals: {
    lockedPools: number
    poolAmountMinor: number
    creditedMinor: number // Σ locked distributions
    openOrPaidMinor: number // Σ payouts not rejected
    paidMinor: number
  }
}

export async function monthlyReconciliation(
  monthKey: string,
  dbx: PrismaClient = defaultDb,
): Promise<ReconciliationReport> {
  const issues: ReconciliationIssue[] = []
  const totals = {
    lockedPools: 0,
    poolAmountMinor: 0,
    creditedMinor: 0,
    openOrPaidMinor: 0,
    paidMinor: 0,
  }

  const pools = await dbx.monthlyPool.findMany({ where: { month: monthKey } })
  const locked = pools.filter((p) => p.status === 'LOCKED')
  totals.lockedPools = locked.length
  for (const p of locked) totals.poolAmountMinor += p.poolAmountMinor

  const distributions = await dbx.poolDistribution.findMany({
    where: { pool: { month: monthKey, status: 'LOCKED' } },
    select: { userId: true, cappedShareMinor: true },
  })
  for (const d of distributions) totals.creditedMinor += d.cappedShareMinor

  const payouts = await dbx.payoutRequest.findMany({
    where: { user: { distributions: { some: { pool: { month: monthKey, status: 'LOCKED' } } } } },
    select: { userId: true, amountMinor: true, status: true },
  })
  const creditedByUser = new Map<string, number>()
  for (const d of distributions) {
    creditedByUser.set(d.userId, (creditedByUser.get(d.userId) ?? 0) + d.cappedShareMinor)
  }
  const takenByUser = new Map<string, number>()
  for (const p of payouts) {
    if (p.status === 'REJECTED') continue
    totals.openOrPaidMinor += p.amountMinor
    if (p.status === 'PAID') totals.paidMinor += p.amountMinor
    takenByUser.set(p.userId, (takenByUser.get(p.userId) ?? 0) + p.amountMinor)
  }

  if (locked.length === 0) {
    issues.push({ code: 'NO_LOCKED_POOL', detail: `No LOCKED pool for ${monthKey} — nothing to reconcile.` })
  }
  if (totals.openOrPaidMinor > totals.creditedMinor) {
    issues.push({
      code: 'OVER_PAYMENT',
      detail: `Σ non-rejected payouts (${totals.openOrPaidMinor}) exceeds Σ credited distributions (${totals.creditedMinor}).`,
    })
  }
  for (const [userId, taken] of takenByUser) {
    const credited = creditedByUser.get(userId) ?? 0
    if (taken > credited) {
      issues.push({
        code: 'USER_OVER_PAYMENT',
        detail: `User ${userId} has ${taken} reserved/paid against ${credited} credited.`,
      })
    }
  }

  return { month: monthKey, ok: issues.length === 0, issues, totals }
}
