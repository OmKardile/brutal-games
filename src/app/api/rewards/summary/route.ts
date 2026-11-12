import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { lifetimePoints, todayProgress, userMonthPoints } from '@/lib/rewards/points'
import { istMonthKey } from '@/lib/rewards/ist'
import { monthPointsByUser } from '@/lib/rewards/points'
import { rewardBalance } from '@/lib/rewards/payouts'
import { estimateShare } from '@/lib/rewards/payout-math'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { user, error } = await authUser()
  if (error) return error

  const settings = await getSettings()
  const enabled = settings.REWARDS_ENABLED

  const monthKey = istMonthKey()
  const [total, thisMonth, today, balance, monthAgg] = await Promise.all([
    lifetimePoints(user.id),
    userMonthPoints(user.id, monthKey),
    todayProgress(user.id, settings),
    rewardBalance(user.id),
    monthPointsByUser(monthKey),
  ])

  // Estimate: if the admin already entered this month's revenue (DRAFT pool),
  // show a live estimate; otherwise there is nothing honest to estimate from.
  const draftPool = await db.monthlyPool.findUnique({ where: { month: monthKey } })
  const poolAmount = draftPool
    ? Math.floor((draftPool.netRevenueMinor * draftPool.sharePercent) / 100)
    : 0
  const estimateMinor = draftPool
    ? estimateShare(poolAmount, thisMonth, monthAgg.totalValidPoints, settings.PAYOUT_CAP_MINOR)
    : null // null = "depends on actual revenue, shown after month close"

  return NextResponse.json({
    enabled,
    lifetimePoints: total,
    monthPoints: thisMonth,
    monthKey,
    today,
    balance,
    estimateMinor,
    estimateBasis: draftPool
      ? 'live preview from the admin-entered revenue for this month'
      : 'unavailable until the month is closed',
    minPayoutMinor: settings.MIN_PAYOUT_MINOR,
    holdPeriodDays: settings.HOLD_PERIOD_DAYS,
    dailyChallenge: enabled ? null : null, // challenge detail comes from /api/rewards/config
  })
}
