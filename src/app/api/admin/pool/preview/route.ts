import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { buildMonthDistribution } from '@/lib/rewards/payouts'

export const dynamic = 'force-dynamic'

/**
 * Preview the distribution for a month WITHOUT persisting anything.
 * Shows top players, per-player caps, leftover, and totals.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Month must be YYYY-MM.' }, { status: 400 })
  }

  const settings = await getSettings()
  const comp = await buildMonthDistribution(month, settings)

  const users = await db.user.findMany({
    where: { id: { in: comp.distributions.map((d) => d.userId) } },
    select: { id: true, email: true, name: true, status: true },
  })
  const byId = new Map(users.map((u) => [u.id, u]))

  const distributions = comp.distributions.slice(0, 100).map((d) => ({
    ...d,
    email: byId.get(d.userId)?.email ?? d.userId,
    name: byId.get(d.userId)?.name ?? null,
    frozen: byId.get(d.userId)?.status === 'FROZEN',
  }))

  return NextResponse.json({
    month,
    netRevenueMinor: comp.netRevenueMinor,
    sharePercent: comp.sharePercent,
    poolAmountMinor: comp.poolAmountMinor,
    totalValidPoints: comp.totalValidPoints,
    paidMinor: comp.paidMinor,
    leftoverMinor: comp.leftoverMinor,
    payoutCapMinor: settings.PAYOUT_CAP_MINOR,
    playerCount: comp.distributions.length,
    distributions,
  })
}
