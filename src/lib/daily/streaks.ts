// Daily streak logic — pure core + DB upsert.
//
// A streak = consecutive days with at least one COMPLETED daily run (any
// game). Server-side for signed-in players (DailyStreak table), localStorage
// for guests, merged on login. The merge is an approximation: we only hold
// {current, longest, lastDateKey} per side, not day-sets — the honest best
// effort is documented below and flagged in technical-documentation.md.

export interface StreakState {
  current: number
  longest: number
  lastDateKey: string
}

export const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastDateKey: '' }

/**
 * Count today's run. Idempotent per day: a second run on the same dateKey
 * does not grow the streak (returns the state unchanged).
 */
export function extendStreak(
  state: StreakState | null,
  todayKey: string,
  yesterdayKey: string,
): StreakState {
  if (!state || state.current === 0) {
    return { current: 1, longest: Math.max(1, state?.longest ?? 0), lastDateKey: todayKey }
  }
  if (state.lastDateKey === todayKey) {
    return state // already counted today
  }
  if (state.lastDateKey === yesterdayKey) {
    const current = state.current + 1
    return { current, longest: Math.max(state.longest, current), lastDateKey: todayKey }
  }
  // chain broken — today starts a fresh streak
  return { current: 1, longest: state.longest, lastDateKey: todayKey }
}

/**
 * Merge a guest (localStorage) streak into the server streak at login/first
 * synced run. Approximation with the data we keep:
 *  - same last day → keep the longer current chain
 *  - one chain's last day is the other's previous day → chains concatenate
 *  - otherwise → the chain that is still alive (today/yesterday) wins,
 *    longest = max of both longest values regardless
 */
export function mergeStreaks(
  server: StreakState | null,
  guest: StreakState | null,
  todayKey: string,
  yesterdayKey: string,
): StreakState {
  if (!guest || guest.current === 0) return server ?? { ...EMPTY_STREAK }
  if (!server || server.current === 0) return guest

  const longest = Math.max(server.longest, guest.longest)

  if (server.lastDateKey === guest.lastDateKey) {
    const winner = server.current >= guest.current ? server : guest
    return { ...winner, longest: Math.max(longest, winner.current) }
  }

  // guest continues server's chain (guest played the day after server's last)
  if (guest.lastDateKey === server.lastDateKey || guest.lastDateKey > server.lastDateKey) {
    // guest chain is the more recent one; if it chains onto server's tail it
    // would only be when guest.lastDateKey is exactly server's next day — we
    // can't know without day sets, so only concatenate on direct adjacency
    // (approximation: compare lastDateKeys textually for adjacent days)
    if (isNextDay(server.lastDateKey, guest.lastDateKey, todayKey, yesterdayKey)) {
      const current = server.current + guest.current
      return { current, longest: Math.max(longest, current), lastDateKey: guest.lastDateKey }
    }
  }

  // keep whichever chain is still alive (counted today or yesterday)
  const serverAlive = server.lastDateKey === todayKey || server.lastDateKey === yesterdayKey
  const guestAlive = guest.lastDateKey === todayKey || guest.lastDateKey === yesterdayKey
  if (serverAlive && !guestAlive) return { ...server, longest }
  if (guestAlive && !serverAlive) return { ...guest, longest }
  return server.current >= guest.current ? { ...server, longest } : { ...guest, longest }
}

/** best-effort adjacency check using only the two keys + today/yesterday anchors */
function isNextDay(earlier: string, later: string, todayKey: string, yesterdayKey: string): boolean {
  // later === today && earlier === yesterday, or later === yesterday && earlier === day before
  if (later === todayKey && earlier === yesterdayKey) return true
  if (later === yesterdayKey) {
    // earlier must be yesterday-1: verify with a 1-day step from yesterday
    const d = new Date(`${yesterdayKey}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return earlier === d.toISOString().slice(0, 10)
  }
  return false
}
