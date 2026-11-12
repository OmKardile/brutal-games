// Payout math — pure functions, edge cases per spec:
// zero revenue, caps, zero total points, rounding, thresholds.

import { describe, expect, it } from 'bun:test'
import {
  computeDistribution,
  computePoolAmount,
  estimateShare,
  meetsThreshold,
} from '../src/lib/rewards/payout-math'

const CAP = 100_000 // ₹1,000 in paise

describe('computePoolAmount', () => {
  it('is zero when revenue is zero', () => {
    expect(computePoolAmount(0, 30)).toBe(0)
  })
  it('is zero when share is zero', () => {
    expect(computePoolAmount(1_000_000, 0)).toBe(0)
  })
  it('is zero for negative revenue', () => {
    expect(computePoolAmount(-500, 30)).toBe(0)
  })
  it('computes 30% of revenue', () => {
    expect(computePoolAmount(100_000, 30)).toBe(30_000) // ₹1,000 -> ₹300
  })
  it('floors fractional paise', () => {
    expect(computePoolAmount(999, 30)).toBe(299) // 299.7 -> 299
  })
})

describe('computeDistribution — zero cases', () => {
  it('pays nothing when revenue is zero (never pay outside the pool)', () => {
    const r = computeDistribution(0, 30, CAP, [
      { userId: 'a', points: 500 },
      { userId: 'b', points: 300 },
    ])
    expect(r.poolAmountMinor).toBe(0)
    expect(r.paidMinor).toBe(0)
    expect(r.distributions.every((d) => d.cappedShareMinor === 0)).toBe(true)
    expect(r.leftoverMinor).toBe(0)
  })

  it('pays nothing when total points are zero', () => {
    const r = computeDistribution(1_000_000, 30, CAP, [])
    expect(r.poolAmountMinor).toBe(300_000)
    expect(r.paidMinor).toBe(0)
    expect(r.leftoverMinor).toBe(300_000) // whole pool stays unpaid
  })

  it('ignores non-positive point entries', () => {
    const r = computeDistribution(100_000, 100, CAP, [
      { userId: 'a', points: 0 },
      { userId: 'b', points: -50 },
      { userId: 'c', points: 100 },
    ])
    expect(r.totalValidPoints).toBe(100)
    expect(r.distributions).toHaveLength(1)
    expect(r.distributions[0].userId).toBe('c')
  })
})

describe('computeDistribution — proportional split', () => {
  it('splits pro-rata', () => {
    const r = computeDistribution(100_000, 100, CAP, [
      { userId: 'a', points: 300 },
      { userId: 'b', points: 100 },
    ])
    // pool = 100000, a gets 75%, b gets 25%
    expect(r.distributions.find((d) => d.userId === 'a')?.cappedShareMinor).toBe(75_000)
    expect(r.distributions.find((d) => d.userId === 'b')?.cappedShareMinor).toBe(25_000)
    expect(r.leftoverMinor).toBe(0)
  })

  it('single player takes the whole pool (under cap)', () => {
    const r = computeDistribution(50_000, 100, CAP, [{ userId: 'solo', points: 42 }])
    expect(r.distributions[0].cappedShareMinor).toBe(50_000)
  })

  it('rounding residue stays in leftover, never overpays', () => {
    const r = computeDistribution(100, 100, CAP, [
      { userId: 'a', points: 1 },
      { userId: 'b', points: 1 },
      { userId: 'c', points: 1 },
    ])
    // 100 paise over 3 players -> 33 each, 1 paise residue
    expect(r.distributions.every((d) => d.cappedShareMinor === 33)).toBe(true)
    expect(r.paidMinor).toBe(99)
    expect(r.leftoverMinor).toBe(1)
    expect(r.paidMinor + r.leftoverMinor).toBe(r.poolAmountMinor)
  })
})

describe('computeDistribution — per-player cap', () => {
  it('caps a single big winner and leaves the rest unpaid', () => {
    const smallCap = 10_000 // ₹100
    const r = computeDistribution(1_000_000, 100, smallCap, [
      { userId: 'whale', points: 1000 },
      { userId: 'minnow', points: 1 },
    ])
    const whale = r.distributions.find((d) => d.userId === 'whale')!
    expect(whale.rawShareMinor).toBe(999_000) // floor(1M * 1000/1001)
    expect(whale.cappedShareMinor).toBe(10_000)
    expect(whale.capped).toBe(true)
    // leftover = pool - paid (cap clamp residue stays unpaid)
    expect(r.leftoverMinor).toBe(1_000_000 - 10_000 - r.distributions.find((d) => d.userId === 'minnow')!.cappedShareMinor)
  })

  it('pays everyone in full when all shares are under the cap', () => {
    const r = computeDistribution(100_000, 100, CAP, [
      { userId: 'a', points: 50 },
      { userId: 'b', points: 50 },
    ])
    expect(r.distributions.every((d) => !d.capped)).toBe(true)
    expect(r.leftoverMinor).toBe(0)
  })
})

describe('estimateShare', () => {
  it('returns zero for zero pool / points', () => {
    expect(estimateShare(0, 100, 200, CAP)).toBe(0)
    expect(estimateShare(50_000, 100, 0, CAP)).toBe(0)
    expect(estimateShare(50_000, 0, 100, CAP)).toBe(0)
  })
  it('applies the cap to estimates too', () => {
    expect(estimateShare(1_000_000, 100, 100, 10_000)).toBe(10_000)
  })
})

describe('meetsThreshold', () => {
  it('rejects amounts below the minimum (carry over)', () => {
    expect(meetsThreshold(9_999, 10_000)).toBe(false)
  })
  it('accepts exactly the minimum', () => {
    expect(meetsThreshold(10_000, 10_000)).toBe(true)
  })
  it('rejects zero and negative amounts', () => {
    expect(meetsThreshold(0, 0)).toBe(false)
    expect(meetsThreshold(-5, 0)).toBe(false)
  })
})
