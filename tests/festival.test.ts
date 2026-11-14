// Roadmap slice 3 tests (ADR-029): festival calendar — windows, themed
// mutator derivation, transforms, multipliers, SEO page data.

import { describe, expect, it } from 'bun:test'
import {
  FESTIVALS,
  festivalFor,
  festivalsInRange,
  daysBetween,
} from '../src/lib/daily/festival'
import {
  mutatorIdFor,
  applyMutator,
  mutatorPlausibilityMultiplier,
  mutatorMeta,
} from '../src/lib/daily/mutators'

// ---------------------------------------------------------------- windows

describe('festival calendar', () => {
  it('every festival has unique ids, valid ISO windows, mutators, copy', () => {
    const ids = new Set<string>()
    for (const f of FESTIVALS) {
      ids.add(f.id)
      expect(f.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(f.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(f.start <= f.end).toBe(true)
      expect(f.mutators.length).toBeGreaterThan(0)
      expect(f.name.length).toBeGreaterThan(3)
      expect(f.blurb.length).toBeGreaterThan(20)
      expect(f.tag.length).toBeGreaterThan(2)
      for (const m of f.mutators) {
        expect(m.id).toMatch(/^festival-/)
        expect(m.label.length).toBeGreaterThan(3)
        expect(m.rule.length).toBeGreaterThan(10)
        expect(m.multiplier).toBeGreaterThanOrEqual(1)
      }
    }
    expect(ids.size).toBe(FESTIVALS.length) // no duplicate ids
  })

  it('no real tournament/team/player names (trademark guard)', () => {
    // themed copy is our own; guard the obvious cricket-league terms
    // (word-bounded so 'triple'/'multiple' never false-positive on 'ipl')
    const banned = ['ipl', 'indian premier league', 'bcci', 'team india', 'icc']
    const haystack = FESTIVALS.map((f) => `${f.id} ${f.name} ${f.blurb} ${f.mutators.map((m) => `${m.id} ${m.label} ${m.rule}`).join(' ')}`).join(' ')
    for (const term of banned) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(haystack)).toBe(false)
    }
  })

  it('festivalFor: inside window returns day info, outside returns null', () => {
    const diwali = FESTIVALS.find((f) => f.id === 'diwali')!
    // inside
    const mid = festivalFor('2026-11-10')
    expect(mid?.festival.id).toBe('diwali')
    expect(mid?.totalDays).toBe(daysBetween(diwali.start, diwali.end) + 1)
    expect(mid?.dayIndex).toBe(daysBetween(diwali.start, '2026-11-10') + 1)
    // edges inclusive
    expect(festivalFor(diwali.start)?.festival.id).toBe('diwali')
    expect(festivalFor(diwali.end)?.festival.id).toBe('diwali')
    // outside
    expect(festivalFor('2026-06-01')).toBeNull()
    expect(festivalFor('2027-06-01')).toBeNull()
  })

  it('festival day mutator is deterministic and rotates inside the window', () => {
    const a = mutatorIdFor('stack', '2026-11-10')
    const b = mutatorIdFor('stack', '2026-11-10')
    expect(a).toBe(b) // same day → same mutator, forever
    expect(a).toMatch(/^festival-/) // override active
    // the plain rotation ids never leak during the window
    expect(a).not.toBe('none')
    expect(['perfect-heavy', 'streak-master', 'tall-tower', 'combo-hunt']).not.toContain(a)
    // mutator ids inside the window all belong to the festival set
    const diwali = FESTIVALS.find((f) => f.id === 'diwali')!
    const allowed = new Set(diwali.mutators.map((m) => m.id))
    for (const day of ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
      expect(allowed.has(mutatorIdFor('stack', day))).toBe(true)
    }
  })

  it('festivalsInRange finds overlapping festivals for a date range', () => {
    const hits = festivalsInRange('2026-11-01', '2026-11-30')
    expect(hits.map((f) => f.id)).toContain('diwali')
    expect(hits.map((f) => f.id)).not.toContain('holi')
    expect(festivalsInRange('2026-02-01', '2026-02-28')).toHaveLength(0)
  })

  it('daysBetween: plain UTC calendar math incl. year boundary', () => {
    expect(daysBetween('2026-11-08', '2026-11-08')).toBe(0)
    expect(daysBetween('2026-11-08', '2026-11-13')).toBe(5)
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2)
  })
})

// ---------------------------------------------------------------- transforms + meta

describe('festival mutators — transforms and multipliers', () => {
  it('every festival mutator id transforms to an integer >= 0', () => {
    const sample = { score: 54, perfects: 9, bestStreak: 5 }
    for (const f of FESTIVALS) {
      for (const m of f.mutators) {
        const out = applyMutator(m.id, sample)
        expect(Number.isInteger(out)).toBe(true)
        expect(out).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('themed transform math: diwali lights = score + perfects×2', () => {
    const s = { score: 54, perfects: 9, bestStreak: 5 }
    expect(applyMutator('festival-diwali-lights', s)).toBe(54 + 18)
    expect(applyMutator('festival-diwali-rockets', s)).toBe(54 + 15)
    expect(applyMutator('festival-holi-colors', s)).toBe(14)
    expect(applyMutator('festival-navratri-nine', s)).toBe(54 + 6) // floor(54/9)
    expect(applyMutator('festival-independence-tricolor', s)).toBe(54 + 18)
    expect(applyMutator('festival-ganesh-modak', s)).toBe(54 + 18)
  })

  it('multipliers: festival ids read their declared multiplier; unknown stays 1', () => {
    for (const f of FESTIVALS) {
      for (const m of f.mutators) {
        expect(mutatorPlausibilityMultiplier(m.id)).toBe(m.multiplier)
      }
    }
    expect(mutatorPlausibilityMultiplier('festival-nope')).toBe(1)
    expect(mutatorPlausibilityMultiplier('none')).toBe(1)
  })

  it('mutatorMeta resolves festival ids to label + rule', () => {
    const meta = mutatorMeta('stack', 'festival-diwali-lights')
    expect(meta.label).toBe('FESTIVAL OF LIGHTS')
    expect(meta.rule.length).toBeGreaterThan(10)
    // base set still resolves
    expect(mutatorMeta('stack', 'perfect-heavy').label).toBe('PERFECT HEAVY')
    // unknown falls back to CLASSIC
    expect(mutatorMeta('stack', 'nope').label).toBe('CLASSIC')
  })
})
