// Pure validation logic: heartbeat timing, run-stat plausibility,
// daily challenges, IP list matching, device fingerprints.

import { describe, expect, it } from 'bun:test'
import { beatAllowed } from '../src/lib/rewards/heartbeat'
import { runCompletionPoints, statsPlausible } from '../src/lib/rewards/runs'
import { challengeMet, dailyChallengeFor } from '../src/lib/rewards/challenge'
import { fingerprintOf, headlessSuspect, ipInList } from '../src/lib/rewards/fraud'
import { istDateKey, istDayRangeUtc, istMonthKey, istMonthRangeUtc } from '../src/lib/rewards/ist'

describe('beatAllowed — heartbeat hardening', () => {
  const interval = 30
  it('accepts beats at or after the interval', () => {
    expect(beatAllowed(0, 30_000, interval)).toBe(true)
    expect(beatAllowed(0, 45_000, interval)).toBe(true)
  })
  it('rejects beats faster than 0.75x interval', () => {
    expect(beatAllowed(0, 1_000, interval)).toBe(false)
    expect(beatAllowed(0, 22_499, interval)).toBe(false)
  })
  it('accepts slightly-late window drift (0.75x boundary)', () => {
    expect(beatAllowed(0, 22_500, interval)).toBe(true)
  })
  it('rejects clock-warp attempts (negative elapsed)', () => {
    expect(beatAllowed(100_000, 0, interval)).toBe(false)
  })
})

describe('statsPlausible — run stats vs server-measured session', () => {
  const ok = { score: 5_000, wave: 5, kills: 120, timeAlive: 300 }
  it('accepts an honest 5-minute run', () => {
    expect(statsPlausible(ok, 302)).toBe(true)
  })
  it('rejects client timeAlive exceeding the server session length', () => {
    expect(statsPlausible({ ...ok, timeAlive: 600 }, 302)).toBe(false)
  })
  it('rejects wave counts that need more time than the session had', () => {
    // 10 waves need >= ~135s server time
    expect(statsPlausible({ ...ok, wave: 10 }, 60)).toBe(false)
  })
  it('rejects impossible kill rates', () => {
    expect(statsPlausible({ ...ok, kills: 5_000 }, 300)).toBe(false)
  })
  it('rejects score/kill ratios no real run can produce', () => {
    expect(statsPlausible({ score: 1_000_000, wave: 5, kills: 10, timeAlive: 300 }, 302)).toBe(false)
  })
  it('rejects negative stats', () => {
    expect(statsPlausible({ score: -1, wave: 1, kills: 1, timeAlive: 10 }, 12)).toBe(false)
  })
})

describe('runCompletionPoints', () => {
  it('scales with waves and caps at 30', () => {
    expect(runCompletionPoints(0)).toBe(0)
    expect(runCompletionPoints(1)).toBe(2)
    expect(runCompletionPoints(5)).toBe(10)
    expect(runCompletionPoints(50)).toBe(30)
  })
})

describe('dailyChallenge', () => {
  it('is deterministic per date and IST-stable', () => {
    const morning = new Date('2026-11-12T02:00:00Z') // 07:30 IST
    const lateNight = new Date('2026-11-12T20:00:00Z') // 01:30 IST Nov 13!
    // 20:00Z on the 12th is already the 13th in IST
    expect(dailyChallengeFor(morning).id).toBe('2026-11-12')
    expect(dailyChallengeFor(lateNight).id).toBe('2026-11-13')
    expect(dailyChallengeFor(morning)).toEqual(dailyChallengeFor(new Date('2026-11-12T18:00:00Z')))
  })
  it('challengeMet matches by kind', () => {
    const ch = { id: 'x', kind: 'WAVE' as const, target: 8, desc: '' }
    expect(challengeMet(ch, { score: 0, wave: 8, kills: 0, timeAlive: 0 })).toBe(true)
    expect(challengeMet(ch, { score: 0, wave: 7, kills: 0, timeAlive: 0 })).toBe(false)
  })
})

describe('ipInList', () => {
  const list = '1.2.3.4, 10.0.0.0/8, 2001:db8::1'
  it('matches exact IPs', () => {
    expect(ipInList('1.2.3.4', list)).toBe(true)
    expect(ipInList('1.2.3.5', list)).toBe(false)
  })
  it('matches IPv4 CIDR ranges', () => {
    expect(ipInList('10.1.2.3', list)).toBe(true)
    expect(ipInList('11.0.0.1', list)).toBe(false)
  })
  it('matches exact IPv6 (no CIDR support)', () => {
    expect(ipInList('2001:db8::1', list)).toBe(true)
    expect(ipInList('2001:db8::2', list)).toBe(false)
  })
  it('handles empty lists', () => {
    expect(ipInList('1.2.3.4', '')).toBe(false)
  })
})

describe('headlessSuspect', () => {
  it('flags automation user agents', () => {
    expect(headlessSuspect('Mozilla/5.0 (X11; Linux) HeadlessChrome/120')).toBe(true)
    expect(headlessSuspect('python-requests/2.31')).toBe(true)
    expect(headlessSuspect('curl/8.1')).toBe(true)
  })
  it('passes normal browsers', () => {
    expect(headlessSuspect('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe(false)
  })
})

describe('fingerprintOf', () => {
  it('is stable for identical signals and differs otherwise', () => {
    const a = { userAgent: 'UA/1', language: 'en', timezone: 'Asia/Kolkata', screen: '800x600 x1' }
    expect(fingerprintOf(a)).toBe(fingerprintOf({ ...a }))
    expect(fingerprintOf(a)).not.toBe(fingerprintOf({ ...a, screen: '1024x768 x2' }))
  })
})

describe('IST boundaries', () => {
  it('day range wraps correctly around the IST offset', () => {
    const r = istDayRangeUtc('2026-11-12')
    expect(r.start.toISOString()).toBe('2026-11-11T18:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-11-12T18:30:00.000Z')
  })
  it('month range covers the full IST month', () => {
    const r = istMonthRangeUtc('2026-11')
    expect(r.start.toISOString()).toBe('2026-10-31T18:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-11-30T18:30:00.000Z')
  })
  it('keys format as YYYY-MM-DD / YYYY-MM', () => {
    expect(istDateKey(new Date('2026-11-12T18:29:00Z'))).toBe('2026-11-12')
    expect(istDateKey(new Date('2026-11-12T18:31:00Z'))).toBe('2026-11-13')
    expect(istMonthKey(new Date('2026-11-12T18:31:00Z'))).toBe('2026-11')
  })
})
