// Reward settings: defaults live in code; overrides live in RewardSetting
// rows (key -> JSON value), editable from the admin UI. First read lazily
// seeds the defaults so the admin UI has something to show.

import { db } from '@/lib/db'

export interface RewardSettings {
  /** Master flag. When false: no points are earned and reward UI is hidden. */
  REWARDS_ENABLED: boolean
  /** Payout kill switch (phase 5): freezes money movement WITHOUT killing the
   *  whole rewards program — admin-flippable at runtime, no redeploy. */
  REWARDS_PAYOUTS_PAUSED: boolean
  /** Two-person approval threshold (paise). 0 = disabled (single-admin
   *  default); above it, a payout needs two DIFFERENT admins to approve. */
  TWO_PERSON_THRESHOLD_MINOR: number
  /** % of net monthly ad revenue that forms the player pool. */
  SHARE_PERCENT: number
  /** Per-player monthly payout cap (paise). */
  PAYOUT_CAP_MINOR: number
  /** Minimum payout amount (paise); below it the balance carries over. */
  MIN_PAYOUT_MINOR: number
  /** Per-player daily point cap. Low by default on purpose. */
  DAILY_POINT_CAP: number
  /** Heartbeat cadence (seconds). Beats faster than this are rejected. */
  HEARTBEAT_INTERVAL_SEC: number
  /** Points awarded per validated heartbeat. */
  HEARTBEAT_POINTS: number
  /** Daily login streak: base award for day 1. */
  STREAK_BASE: number
  /** Daily login streak: maximum award. */
  STREAK_MAX: number
  /** Points for completing the daily challenge. */
  DAILY_CHALLENGE_POINTS: number
  /** Days a payout request must wait before an admin may approve it. */
  HOLD_PERIOD_DAYS: number
  /** Comma-separated IPs/CIDRs treated as VPN/datacenter (flag for review). */
  VPN_IP_LIST: string
  /** KYC collection (off in v1; fields stored so it can be enabled later). */
  KYC_REQUIRED: boolean
  KYC_FIELDS: string[]
}

export const DEFAULT_SETTINGS: RewardSettings = {
  REWARDS_ENABLED: false,
  REWARDS_PAYOUTS_PAUSED: false,
  TWO_PERSON_THRESHOLD_MINOR: 0, // disabled by default (single-admin reality)
  SHARE_PERCENT: 30,
  PAYOUT_CAP_MINOR: 100_000, // ₹1,000
  MIN_PAYOUT_MINOR: 10_000, // ₹100
  DAILY_POINT_CAP: 100,
  HEARTBEAT_INTERVAL_SEC: 30,
  HEARTBEAT_POINTS: 1,
  STREAK_BASE: 5,
  STREAK_MAX: 30,
  DAILY_CHALLENGE_POINTS: 20,
  HOLD_PERIOD_DAYS: 14,
  VPN_IP_LIST: '',
  KYC_REQUIRED: false,
  KYC_FIELDS: ['fullName', 'panNumber', 'phoneNumber'],
}

const INT_KEYS = [
  'SHARE_PERCENT',
  'PAYOUT_CAP_MINOR',
  'MIN_PAYOUT_MINOR',
  'DAILY_POINT_CAP',
  'HEARTBEAT_INTERVAL_SEC',
  'HEARTBEAT_POINTS',
  'STREAK_BASE',
  'STREAK_MAX',
  'DAILY_CHALLENGE_POINTS',
  'HOLD_PERIOD_DAYS',
  'TWO_PERSON_THRESHOLD_MINOR',
] as const

let seeded = false

async function ensureSeeded(): Promise<void> {
  if (seeded) return
  const existing = await db.rewardSetting.findMany()
  const have = new Set(existing.map((r) => r.key))
  const missing = Object.entries(DEFAULT_SETTINGS)
    .filter(([k]) => !have.has(k))
    .map(([k, v]) => ({ key: k, value: JSON.stringify(v) }))
  if (missing.length) {
    await db.rewardSetting.createMany({ data: missing }).catch(() => undefined)
  }
  seeded = true
}

export async function getSettings(): Promise<RewardSettings> {
  await ensureSeeded()
  const rows = await db.rewardSetting.findMany()
  const out: RewardSettings = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value)
      if (row.key in DEFAULT_SETTINGS) {
        ;(out as unknown as Record<string, unknown>)[row.key] = parsed
      }
    } catch {
      // corrupt row — fall back to default
    }
  }
  return out
}

/** Admin-only writes. Values are validated and clamped to sane ranges. */
export async function updateSettings(patch: Partial<RewardSettings>): Promise<RewardSettings> {
  const clean: Partial<RewardSettings> = {}
  if (typeof patch.REWARDS_ENABLED === 'boolean') clean.REWARDS_ENABLED = patch.REWARDS_ENABLED
  if (typeof patch.REWARDS_PAYOUTS_PAUSED === 'boolean') {
    clean.REWARDS_PAYOUTS_PAUSED = patch.REWARDS_PAYOUTS_PAUSED
  }
  for (const k of INT_KEYS) {
    const v = patch[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      clean[k] = Math.max(0, Math.floor(v)) as never
    }
  }
  if (typeof patch.VPN_IP_LIST === 'string') clean.VPN_IP_LIST = patch.VPN_IP_LIST
  if (typeof patch.KYC_REQUIRED === 'boolean') clean.KYC_REQUIRED = patch.KYC_REQUIRED
  if (Array.isArray(patch.KYC_FIELDS)) {
    clean.KYC_FIELDS = patch.KYC_FIELDS.filter((f) => typeof f === 'string').slice(0, 20)
  }
  // sanity: share percent 0..100
  clean.SHARE_PERCENT = Math.min(100, Math.max(0, clean.SHARE_PERCENT ?? DEFAULT_SETTINGS.SHARE_PERCENT))
  await ensureSeeded()
  for (const [k, v] of Object.entries(clean)) {
    await db.rewardSetting.upsert({
      where: { key: k },
      update: { value: JSON.stringify(v) },
      create: { key: k, value: JSON.stringify(v) },
    })
  }
  return getSettings()
}
