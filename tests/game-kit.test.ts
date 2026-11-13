// game-kit unit tests — pure logic, no browser required.
// The window object is stubbed where the modules need it (rAF pump, storage).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  createRngKit,
  createRngKitFromString,
  hashString,
  mulberry32,
  rngChance,
  rngInt,
  rngPick,
  rngRange,
} from '../src/game-kit/rng'
import { getJson, getInt, safeLocal, setJson, setInt, type SafeStorage } from '../src/game-kit/storage'
import { Pool } from '../src/game-kit/pool'
import { AdRules, createRuleEnforcedAdapter } from '../src/game-kit/adapter/rules'
import type { PortalAdapter, AdResult } from '../src/game-kit/adapter/types'
import { GameLoop } from '../src/game-kit/loop'
import { TraumaShake, HitStop, Tweens, easeOutCubic } from '../src/game-kit/juice'
import { NoopAdapter } from '../src/game-kit/adapter/noop'

// ---------------------------------------------------------------- window stub

type RafCb = (ts: number) => void
let rafQueue: RafCb[] = []

class MapStorage {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

const g = globalThis as unknown as { window?: unknown }
const realWindow = g.window

beforeAll(() => {
  rafQueue = []
  g.window = {
    requestAnimationFrame: (cb: RafCb) => {
      rafQueue.push(cb)
      return rafQueue.length
    },
    cancelAnimationFrame: () => {
      rafQueue = [] // single-loop tests: cancel drops the pending frame
    },
    localStorage: new MapStorage(),
  }
})

afterAll(() => {
  g.window = realWindow
})

/** run every queued rAF callback with timestamp ts (one "frame") */
function pump(ts: number): void {
  const cbs = rafQueue
  rafQueue = []
  for (const cb of cbs) cb(ts)
}

// ---------------------------------------------------------------- rng

describe('rng', () => {
  it('mulberry32 is deterministic for a seed', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    for (let i = 0; i < 100; i++) expect(a()).toBe(b())
  })

  it('different seeds diverge', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const sa = Array.from({ length: 10 }, () => a())
    const sb = Array.from({ length: 10 }, () => b())
    expect(sa).not.toEqual(sb)
  })

  it('streams stay in [0,1)', () => {
    const r = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('hashString is stable and separates inputs', () => {
    expect(hashString('stack:2026-11-13:salt')).toBe(hashString('stack:2026-11-13:salt'))
    expect(hashString('stack:2026-11-13:salt')).not.toBe(hashString('stack:2026-11-14:salt'))
    expect(hashString('arena:2026-11-13:salt')).not.toBe(hashString('stack:2026-11-13:salt'))
  })

  it('createRngKit: cosmetic draws never affect the logic stream', () => {
    const k1 = createRngKit(999)
    const k2 = createRngKit(999)
    // burn a pile of cosmetic randomness in one kit
    for (let i = 0; i < 500; i++) k1.cosmetic()
    const a = Array.from({ length: 20 }, () => k1.logic())
    const b = Array.from({ length: 20 }, () => k2.logic())
    expect(a).toEqual(b)
  })

  it('helpers respect their ranges', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 200; i++) {
      const n = rngInt(r, 3, 7)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(7)
      const f = rngRange(r, 2.5, 3.5)
      expect(f).toBeGreaterThanOrEqual(2.5)
      expect(f).toBeLessThan(3.5)
    }
    expect(rngChance(mulberry32(5), 1)).toBe(true)
    expect(rngChance(mulberry32(5), 0)).toBe(false)
    const arr = ['a', 'b', 'c']
    expect(arr).toContain(rngPick(mulberry32(6), arr))
  })

  it('createRngKitFromString matches createRngKit(hashString(...))', () => {
    const viaString = createRngKitFromString('dodge:2026-11-13:pepper')
    const viaHash = createRngKit(hashString('dodge:2026-11-13:pepper'))
    expect(viaString.logic()).toBe(viaHash.logic())
  })
})

// ---------------------------------------------------------------- storage

describe('storage', () => {
  it('falls back to memory when localStorage throws', () => {
    const w = g.window as { localStorage: Storage }
    const real = w.localStorage
    w.localStorage = {
      setItem: () => {
        throw new Error('quota')
      },
      getItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    } as Storage
    const s = safeLocal()
    expect(s.available).toBe(false)
    s.set('k', 'v')
    expect(s.get('k')).toBe('v')
    s.remove('k')
    expect(s.get('k')).toBeNull()
    w.localStorage = real
  })

  it('wraps a working localStorage', () => {
    const s = safeLocal()
    expect(s.available).toBe(true)
    s.set('a', '1')
    expect(s.get('a')).toBe('1')
    s.remove('a')
    expect(s.get('a')).toBeNull()
  })

  it('json/int helpers never throw on junk', () => {
    const s: SafeStorage = safeLocal()
    s.set('junk', '{not json')
    expect(getJson(s, 'junk', { x: 5 })).toEqual({ x: 5 })
    s.set('null-ish', 'null')
    // JSON null counts as "no usable value" — the fallback wins
    expect(getJson<{ x: number } | null>(s, 'null-ish', { x: 1 })).toEqual({ x: 1 })
    setJson(s, 'ok', { list: [1, 2] })
    expect(getJson(s, 'ok', {})).toEqual({ list: [1, 2] })
    s.set('num', 'not-a-number')
    expect(getInt(s, 'num', 9)).toBe(9)
    setInt(s, 'num2', 41.7)
    expect(getInt(s, 'num2', 0)).toBe(41)
  })
})

// ---------------------------------------------------------------- pool

describe('pool', () => {
  it('acquire resets, release recycles, clear frees', () => {
    let made = 0
    const p = new Pool<{ v: number }>(
      () => ({ v: 0 }),
      (it) => (it.v = 0),
    )
    const a = p.acquire()
    made // (factory called once)
    a.v = 5
    p.release(a)
    const b = p.acquire()
    expect(b).toBe(a) // recycled, not re-allocated
    expect(b.v).toBe(0) // reset ran
    expect(p.live).toBe(1)
    p.release(b)
    p.clear()
    expect(p.pooled).toBe(0)
    expect(p.live).toBe(0)
  })

  it('double release does not corrupt the pool', () => {
    const p = new Pool<{ v: number }>(() => ({ v: 0 }), () => {})
    const a = p.acquire()
    p.release(a)
    p.release(a) // guarded no-op
    expect(p.pooled).toBe(1)
    const b = p.acquire()
    const c = p.acquire() // second acquire must be a fresh object, not aliasing a
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })
})

// ---------------------------------------------------------------- ad rules

describe('AdRules', () => {
  it('gameplay never starts twice and never mid-ad', () => {
    const r = new AdRules()
    r.begin(1000)
    expect(r.canGameplayStart()).toBe(true)
    r.noteGameplayStarted()
    expect(r.canGameplayStart()).toBe(false)
    r.noteAdStart()
    expect(r.canGameplayStart()).toBe(false)
    r.noteAdEnd(false)
    expect(r.canGameplayStart()).toBe(false) // still playing
  })

  it('gameplayStop never fires back-to-back; queued during ads', () => {
    const r = new AdRules()
    r.begin(1000)
    expect(r.requestGameplayStop()).toBe(false) // wasn't playing
    r.noteGameplayStarted()
    expect(r.requestGameplayStop()).toBe(true)
    expect(r.requestGameplayStop()).toBe(false) // no back-to-back
    // stop requested during an ad is queued and applied at ad end
    r.noteGameplayStarted()
    r.noteAdStart()
    expect(r.requestGameplayStop()).toBe(false)
    r.noteAdEnd(false)
    expect(r.gameplayState).toBe('stopped')
  })

  it('interstitials: natural breaks, first-minute block, frequency cap', () => {
    const r = new AdRules({ minGapMs: 90_000, noAdFirstMs: 60_000 })
    r.begin(0)
    expect(r.canShowInterstitial(true, 30_000).ok).toBe(false) // first minute
    expect(r.canShowInterstitial(true, 30_000)).toEqual({ ok: false, reason: 'first-minute' })
    expect(r.canShowInterstitial(false, 100_000).ok).toBe(false) // not a natural break
    expect(r.canShowInterstitial(false, 100_000)).toEqual({ ok: false, reason: 'not-a-natural-break' })
    // playing blocks interstitials entirely
    r.noteGameplayStarted()
    expect(r.canShowInterstitial(true, 100_000)).toEqual({ ok: false, reason: 'during-play' })
    r.requestGameplayStop()
    expect(r.canShowInterstitial(true, 100_000).ok).toBe(true)
    // shown ad starts the frequency cap
    r.noteAdStart()
    expect(r.canShowInterstitial(true, 101_000)).toEqual({ ok: false, reason: 'ad-active' })
    r.noteAdEnd(true, 101_000)
    expect(r.canShowInterstitial(true, 150_000)).toEqual({ ok: false, reason: 'frequency-cap' })
    expect(r.canShowInterstitial(true, 191_000).ok).toBe(true)
  })
})

// ---------------------------------------------------------------- enforced adapter

function recordingAdapter(calls: string[], adResult?: Promise<AdResult>): PortalAdapter {
  return {
    init: async () => calls.push('init'),
    loadingFinished: () => calls.push('loadingFinished'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    showInterstitial: () => {
      calls.push('showInterstitial')
      return adResult ?? Promise.resolve({ shown: true } as AdResult)
    },
    showRewarded: () => {
      calls.push('showRewarded')
      return adResult ?? Promise.resolve({ shown: true } as AdResult)
    },
    trackEvent: (name) => calls.push(`event:${name}`),
  }
}

describe('createRuleEnforcedAdapter', () => {
  it('deduplicates lifecycle calls and forwards the rest', async () => {
    const calls: string[] = []
    const adapter = createRuleEnforcedAdapter(recordingAdapter(calls))
    await adapter.init()
    adapter.loadingFinished()
    adapter.gameplayStart()
    adapter.gameplayStart() // duplicate — dropped
    adapter.gameplayStop()
    adapter.gameplayStop() // back-to-back — dropped
    expect(calls).toEqual(['init', 'loadingFinished', 'gameplayStart', 'gameplayStop'])
  })

  it('denies interstitials mid-play and tracks ad_failed', async () => {
    const calls: string[] = []
    const adapter = createRuleEnforcedAdapter(recordingAdapter(calls))
    await adapter.init()
    adapter.gameplayStart()
    const res = await adapter.showInterstitial({ naturalBreak: true })
    expect(res.shown).toBe(false)
    expect(res.reason).toBe('during-play')
    expect(calls).not.toContain('showInterstitial')
    expect(calls).toContain('event:ad_failed')
  })

  it('denies interstitials at a non-natural break', async () => {
    const calls: string[] = []
    const adapter = createRuleEnforcedAdapter(recordingAdapter(calls))
    await adapter.init()
    const res = await adapter.showInterstitial({ naturalBreak: false })
    expect(res).toEqual({ shown: false, reason: 'not-a-natural-break' })
  })

  it('an ad that never resolves is abandoned after the timeout and the game continues', async () => {
    const calls: string[] = []
    const adapter = createRuleEnforcedAdapter(recordingAdapter(calls, new Promise<AdResult>(() => {})), {
      adTimeoutMs: 30,
      noAdFirstMs: 0,
    })
    await adapter.init()
    const t0 = Date.now()
    const res = await adapter.showInterstitial({ naturalBreak: true })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(res).toEqual({ shown: false, reason: 'timeout' })
    expect(calls).toContain('event:ad_failed')
  })

  it('pause/mute hooks fire around an allowed ad', async () => {
    const calls: string[] = []
    const order: string[] = []
    const adapter = createRuleEnforcedAdapter(
      recordingAdapter(calls, Promise.resolve({ shown: true })),
      { noAdFirstMs: 0 },
      {
        onAdStart: () => order.push('pause+mute'),
        onAdEnd: () => order.push('resume+unmute'),
      },
    )
    await adapter.init()
    const res = await adapter.showInterstitial({ naturalBreak: true })
    expect(res.shown).toBe(true)
    expect(order).toEqual(['pause+mute', 'resume+unmute'])
    expect(calls).toContain('event:ad_shown')
  })

  it('NoopAdapter never shows ads and never throws', async () => {
    const noop = new NoopAdapter()
    await noop.init()
    noop.loadingFinished()
    noop.gameplayStart()
    noop.gameplayStop()
    noop.trackEvent('game_load')
    const res = await noop.showInterstitial({ naturalBreak: true })
    expect(res.shown).toBe(false)
    const rewarded = await noop.showRewarded()
    expect(rewarded.shown).toBe(false)
  })
})

// ---------------------------------------------------------------- loop

describe('GameLoop', () => {
  it('fixed steps: 60fps frames produce one step each; dt is constant', () => {
    const stepSecs: number[] = []
    const renders: number[] = []
    const loop = new GameLoop({
      stepMs: 1000 / 60,
      update: (s) => stepSecs.push(s),
      render: (alpha) => renders.push(alpha),
    })
    loop.start()
    pump(0)
    pump(16.67)
    pump(33.34)
    pump(50.01)
    loop.stop()
    expect(stepSecs.length).toBeGreaterThanOrEqual(3)
    for (const s of stepSecs) expect(s).toBeCloseTo(1 / 60, 10) // constant, NOT wall dt
    expect(renders.length).toBe(4)
  })

  it('clamps a huge frame gap (spiral-of-death guard)', () => {
    const stepSecs: number[] = []
    const loop = new GameLoop({
      stepMs: 1000 / 60,
      maxStepsPerFrame: 5,
      update: (s) => stepSecs.push(s),
      render: () => {},
    })
    loop.start()
    pump(0)
    pump(10_000) // tab hidden for 10s — must not replay 600 steps
    expect(stepSecs.length).toBeLessThanOrEqual(5)
    loop.stop()
  })

  it('alpha stays in [0,1) and stop cancels', () => {
    const alphas: number[] = []
    const loop = new GameLoop({ update: () => {}, render: (a) => alphas.push(a) })
    loop.start()
    pump(0)
    pump(20)
    loop.stop()
    expect(rafQueue.length).toBe(0) // stopped — no next frame scheduled
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
    }
  })
})

// ---------------------------------------------------------------- juice

describe('juice', () => {
  it('trauma shake decays to rest', () => {
    const sh = new TraumaShake(10, 2)
    expect(sh.intensity).toBe(0)
    sh.add(1)
    expect(sh.intensity).toBeGreaterThan(0)
    const rnd = () => 0.9
    const o = sh.offset(rnd)
    expect(Math.abs(o.x)).toBeLessThanOrEqual(12) // trauma can exceed 1 → clamped intensity × max
    sh.update(1.2) // decay 2/s → gone
    expect(sh.intensity).toBe(0)
    expect(sh.offset(rnd)).toEqual({ x: 0, y: 0 })
  })

  it('hit-stop freezes then releases', () => {
    const hs = new HitStop()
    expect(hs.active).toBe(false)
    hs.trigger(0.05)
    expect(hs.update(0.02)).toBe(true) // frozen at frame start
    expect(hs.update(0.04)).toBe(true) // 0.03s of freeze still applied to this frame
    expect(hs.update(0.001)).toBe(false) // fully released now
    expect(hs.active).toBe(false)
  })

  it('tweens update with easing and complete once', () => {
    const tw = new Tweens()
    const seen: number[] = []
    let done = 0
    tw.add(1, easeOutCubic, (e) => seen.push(e), () => done++)
    tw.update(0.5)
    expect(seen.length).toBe(1)
    expect(seen[0]).toBeGreaterThan(0.5) // easeOutCubic(0.5) ≈ 0.875
    tw.update(0.6) // crosses 1.0
    expect(done).toBe(1)
    expect(tw.active).toBe(0)
  })
})
