// Payout math — PURE functions, no DB, no I/O. Everything here is covered by
// tests/payout-math.test.ts. Money is int paise. Points are int.
//
// Rules implemented (see decisions.md):
//   pool            = floor(netRevenueMinor * sharePercent / 100)
//   payout_i        = min(floor(pool * points_i / totalPoints), payoutCapMinor)
//   leftover        = pool - Σ payouts   (stays unpaid, shown in pool preview)
//   zero revenue or zero total points  -> every payout is 0; nothing is ever
//                                        paid from anywhere except the pool.

export interface ShareInput {
  userId: string
  points: number
}

export interface ShareResult {
  userId: string
  points: number
  rawShareMinor: number
  cappedShareMinor: number
  capped: boolean
}

export interface PoolComputation {
  poolAmountMinor: number
  totalValidPoints: number
  distributions: ShareResult[]
  leftoverMinor: number
  paidMinor: number
}

export function computePoolAmount(netRevenueMinor: number, sharePercent: number): number {
  if (netRevenueMinor <= 0 || sharePercent <= 0) return 0
  return Math.floor((netRevenueMinor * sharePercent) / 100)
}

export function computeDistribution(
  netRevenueMinor: number,
  sharePercent: number,
  payoutCapMinor: number,
  entries: ShareInput[],
): PoolComputation {
  const poolAmountMinor = computePoolAmount(netRevenueMinor, sharePercent)
  const valid = entries.filter((e) => Number.isInteger(e.points) && e.points > 0)
  const totalValidPoints = valid.reduce((s, e) => s + e.points, 0)

  const distributions: ShareResult[] = valid.map((e) => {
    const rawShareMinor =
      poolAmountMinor <= 0 || totalValidPoints <= 0
        ? 0
        : Math.floor((poolAmountMinor * e.points) / totalValidPoints)
    const cappedShareMinor = Math.min(rawShareMinor, Math.max(0, payoutCapMinor))
    return {
      userId: e.userId,
      points: e.points,
      rawShareMinor,
      cappedShareMinor,
      capped: cappedShareMinor < rawShareMinor,
    }
  })

  const paidMinor = distributions.reduce((s, d) => s + d.cappedShareMinor, 0)
  return {
    poolAmountMinor,
    totalValidPoints,
    distributions,
    leftoverMinor: Math.max(0, poolAmountMinor - paidMinor),
    paidMinor,
  }
}

/** Live estimate for the rewards page (clearly labeled as an estimate). */
export function estimateShare(
  poolAmountMinor: number,
  userPoints: number,
  totalPoints: number,
  payoutCapMinor: number,
): number {
  if (poolAmountMinor <= 0 || totalPoints <= 0 || userPoints <= 0) return 0
  const raw = Math.floor((poolAmountMinor * userPoints) / totalPoints)
  return Math.min(raw, Math.max(0, payoutCapMinor))
}

/**
 * Payout threshold: amounts below MIN_PAYOUT_MINOR are not payable; the
 * balance simply carries over (no payout row is created).
 */
export function meetsThreshold(amountMinor: number, minPayoutMinor: number): boolean {
  return amountMinor > 0 && amountMinor >= Math.max(0, minPayoutMinor)
}

export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}₹${Math.floor(abs / 100).toLocaleString('en-IN')}.${String(abs % 100).padStart(2, '0')}`
}
