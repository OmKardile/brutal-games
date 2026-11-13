// Daily-challenge timezone helpers.
//
// The day boundary is CONFIGURABLE (PortalSetting DAILY_TZ, default
// 'Asia/Kolkata' — the rewards program already runs on IST, see ADR-001).
// Unlike rewards/ist.ts (fixed +5:30 offset), this supports any IANA zone via
// Intl — including DST zones — because dateKeyForTz reads the wall clock
// directly from the formatter. "Yesterday" walks back in hour steps so a DST
// spring-forward/fall-back can never produce a wrong calendar day.

export const DEFAULT_DAILY_TZ = 'Asia/Kolkata'
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' of `now` as read on the wall clock in `tz`. */
export function dateKeyForTz(now: Date = new Date(), tz: string = DEFAULT_DAILY_TZ): string {
  // en-CA yields ISO-like YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(now)
}

/** The previous calendar dateKey in `tz` (DST-safe: hour-walk, ≤ 25 steps). */
export function previousDateKey(now: Date = new Date(), tz: string = DEFAULT_DAILY_TZ): string {
  const today = dateKeyForTz(now, tz)
  for (let back = 1; back <= 25; back++) {
    const probe = new Date(now.getTime() - back * 3600_000)
    const key = dateKeyForTz(probe, tz)
    if (key !== today) return key
  }
  return today // unreachable in practice (no zone shifts > 24h)
}

export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_RE.test(key)) return false
  const d = new Date(`${key}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key
}

/** N days BEFORE the given dateKey (all at 00:00 UTC arithmetic). */
export function dateKeyMinus(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}
