// IST (Asia/Kolkata, UTC+5:30) day/month boundaries for the rewards program.
// All "daily" and "monthly" windows in the reward system use IST.

export const IST_OFFSET_MS = 5.5 * 3600_000

/** Shifted date whose UTC getters read IST wall-clock values. */
export function istShifted(now: Date = new Date()): Date {
  return new Date(now.getTime() + IST_OFFSET_MS)
}

export function istDateKey(now: Date = new Date()): string {
  const d = istShifted(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function istMonthKey(now: Date = new Date()): string {
  const d = istShifted(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

/** UTC instant range covering one IST calendar day. */
export function istDayRangeUtc(dateKey: string): { start: Date; end: Date } {
  if (!DATE_RE.test(dateKey)) throw new Error(`bad date key: ${dateKey}`)
  // IST midnight = UTC midnight minus 5:30
  const start = new Date(new Date(`${dateKey}T00:00:00Z`).getTime() - IST_OFFSET_MS)
  return { start, end: new Date(start.getTime() + 24 * 3600_000) }
}

/** UTC instant range covering one IST calendar month. */
export function istMonthRangeUtc(monthKey: string): { start: Date; end: Date } {
  if (!MONTH_RE.test(monthKey)) throw new Error(`bad month key: ${monthKey}`)
  const start = new Date(`${monthKey}-01T00:00:00Z`)
  const end = new Date(
    start.getTime() + IST_OFFSET_MS * 0, // placeholder, computed below
  )
  // first day of next month
  const y = Number(monthKey.slice(0, 4))
  const m = Number(monthKey.slice(5, 7))
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  end.setTime(
    new Date(
      `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00Z`,
    ).getTime() - IST_OFFSET_MS,
  )
  start.setTime(start.getTime() - IST_OFFSET_MS)
  return { start, end }
}

export function istYesterdayKey(dateKey: string): string {
  const { start } = istDayRangeUtc(dateKey)
  const y = new Date(start.getTime() - 24 * 3600_000 + IST_OFFSET_MS)
  return `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, '0')}-${String(y.getUTCDate()).padStart(2, '0')}`
}
