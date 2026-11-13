// Daily/portal config: code defaults overridable via the PortalSetting table
// (admin-editable later; same lazy pattern as rewards/config.ts — no seeding
// step, DB overrides simply win when present).

import { db } from '@/lib/db'
import { DEFAULT_DAILY_TZ } from './tz'

export interface PortalConfig {
  /** IANA timezone whose midnight is the daily day boundary */
  DAILY_TZ: string
  /** minimum distance between interstitials */
  INTERSTITIAL_MIN_GAP_MS: number
  /** no interstitial before this much session time */
  INTERSTITIAL_FIRST_MINUTE_MS: number
  /** an ad that takes longer is abandoned — the game continues */
  AD_TIMEOUT_MS: number
  /** hard cap on stored input-log length (chars) */
  DAILY_INPUT_LOG_MAX_CHARS: number
}

export const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  DAILY_TZ: DEFAULT_DAILY_TZ,
  INTERSTITIAL_MIN_GAP_MS: 90_000,
  INTERSTITIAL_FIRST_MINUTE_MS: 60_000,
  AD_TIMEOUT_MS: 5_000,
  DAILY_INPUT_LOG_MAX_CHARS: 16_384,
}

const INT_KEYS: (keyof PortalConfig)[] = [
  'INTERSTITIAL_MIN_GAP_MS',
  'INTERSTITIAL_FIRST_MINUTE_MS',
  'AD_TIMEOUT_MS',
  'DAILY_INPUT_LOG_MAX_CHARS',
]

/** Read config with DB overrides. Values are JSON-encoded strings. */
export async function getPortalConfig(): Promise<PortalConfig> {
  const cfg: PortalConfig = { ...DEFAULT_PORTAL_CONFIG }
  try {
    const rows = await db.portalSetting.findMany()
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value) as unknown
        switch (row.key) {
          case 'DAILY_TZ':
            if (typeof parsed === 'string' && parsed.length > 0) cfg.DAILY_TZ = parsed
            break
          default:
            if (INT_KEYS.includes(row.key as keyof PortalConfig) && typeof parsed === 'number') {
              ;(cfg[row.key as keyof PortalConfig] as number) = Math.max(0, Math.trunc(parsed))
            }
        }
      } catch {
        // corrupt row — ignore, default wins
      }
    }
  } catch {
    // db unavailable — defaults
  }
  return cfg
}
