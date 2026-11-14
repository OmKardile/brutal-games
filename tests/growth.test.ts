// Roadmap slices 0+1 tests (ADR-029): daily mutators + retention read-out.
// Pure parts in-file; retention math against a throwaway DB (same pattern
// as daily.test.ts).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  mutatorIdFor,
  mutatorFor,
  applyMutator,
  mutatorPlausibilityMultiplier,
  gameHasMutators,
  STACK_MUTATORS,
} from '../src/lib/daily/mutators'
import { checkPlausibility } from '../src/lib/daily/plausibility'
import { retentionReport } from '../src/lib/daily/stats'
import { recordDailyRun } from '../src/lib/daily/board'
import { manifest as stackManifest } from '../src/games/stack/manifest'

// ---------------------------------------------------------------- mutators

describe('daily mutators', () => {
  it('derivation is deterministic: same slug+day → same mutator, forever', () => {
    for (let d = 0; d < 5; d++) {
      const key = `2026-11-${String(10 + d).padStart(2, '0')}`
      expect(mutatorIdFor('stack', key)).toBe(mutatorIdFor('stack', key))
    }
  })

  it('different days get a spread of mutators (rotation actually rotates)', () => {
    const ids = new Set<string>()
    for (let d = 1; d <= 20; d++) {
      ids.add(mutatorIdFor('stack', `2026-10-${String(d).padStart(2, '0')}`))
    }
    // over 20 days every one of the 5 stack mutators should appear at least
    // twice (deterministic hash, not random — but the spread must be real)
    expect(ids.size).toBeGreaterThanOrEqual(4)
  })

  it('games without a mutator set report none (no UI for them)', () => {
    expect(gameHasMutators('arena')).toBe(false)
    expect(mutatorIdFor('arena', '2026-11-13')).toBe('none')
    expect(gameHasMutators('stack')).toBe(true)
  })

  it('mutatorFor falls back to CLASSIC on unknown ids (server data wins)', () => {
    expect(mutatorFor('stack', 'nope').id).toBe('none')
    expect(mutatorFor('stack', null).id).toBe('none')
    expect(mutatorFor('stack', 'perfect-heavy').label).toBe('PERFECT HEAVY')
  })

  it('score transforms: every mutator has a rule and stays integer >= 0', () => {
    const sample = { score: 42, perfects: 13, bestStreak: 7 }
    for (const m of STACK_MUTATORS) {
      const out = applyMutator(m.id, sample)
      expect(Number.isInteger(out)).toBe(true)
      expect(out).toBeGreaterThanOrEqual(0)
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.rule.length).toBeGreaterThan(0)
    }
  })

  it('score transforms: exact math per mutator', () => {
    const s = { score: 42, perfects: 13, bestStreak: 7 }
    expect(applyMutator('none', s)).toBe(42)
    expect(applyMutator('perfect-heavy', s)).toBe(55) // 42 + 13
    expect(applyMutator('streak-master', s)).toBe(7)
    expect(applyMutator('tall-tower', s)).toBe(42)
    expect(applyMutator('combo-hunt', s)).toBe(20) // 13 + 7
    // zero-guards
    expect(applyMutator('streak-master', { score: 10, perfects: 0, bestStreak: 0 })).toBe(0)
    expect(applyMutator('combo-hunt', { score: 0, perfects: 0, bestStreak: 0 })).toBe(0)
  })
})

// ---------------------------------------------------------------- plausibility × mutators

describe('plausibility with mutator multipliers', () => {
  it('classic ceiling unchanged (multiplier default 1)', () => {
    const v = checkPlausibility(stackManifest, { score: 60, durationMs: 20_000 })
    expect(v.ok).toBe(true)
    const bad = checkPlausibility(stackManifest, { score: 999, durationMs: 20_000 })
    expect(bad.ok).toBe(false)
  })

  it('a doubled-scoring mutator day accepts doubled honest scores', () => {
    // classic ceiling for a 20 s stack run: 5 × (20+5) = 125. A perfect-heavy
    // day doubles honest scoring → a 200 (100 blocks + 100 perfects) run must
    // pass on the mutator day and would be flagged on a classic day.
    const classic = checkPlausibility(stackManifest, { score: 200, durationMs: 20_000 })
    expect(classic.ok).toBe(false) // classic day: flagged
    const mutDay = checkPlausibility(stackManifest, {
      score: 200,
      durationMs: 20_000,
      multiplier: mutatorPlausibilityMultiplier('perfect-heavy'),
    })
    expect(mutDay.ok).toBe(true) // mutator day: passes
  })

  it('cheater ceiling scales with the multiplier, not beyond it', () => {
    const m = mutatorPlausibilityMultiplier('combo-hunt')
    expect(m).toBe(2)
    const absurd = checkPlausibility(stackManifest, { score: 10_000, durationMs: 20_000, multiplier: m })
    expect(absurd.ok).toBe(false) // still impossible → still rejected
  })

  it('every stack mutator has a multiplier >= 1 (never tightens)', () => {
    for (const m of STACK_MUTATORS) {
      expect(mutatorPlausibilityMultiplier(m.id)).toBeGreaterThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------- retention (temp DB)

const DB_PATH = join(tmpdir(), `brutal-stats-test-${Date.now()}.db`)
let db: PrismaClient

beforeAll(async () => {
  const push = spawnSync(
    'bunx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
      encoding: 'utf8',
    },
  )
  if (push.status !== 0) throw new Error('prisma db push failed: ' + push.stdout + push.stderr)
  db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
  // DailyRun.user is a real FK — referenced users must exist BEFORE the runs
  await db.user.createMany({
    data: [
      { id: 'u1', email: 'u1@t.test', passwordHash: 'x' },
      { id: 'u2', email: 'u2@t.test', passwordHash: 'x' },
    ],
  })
})

afterAll(async () => {
  await db?.$disconnect().catch(() => undefined)
  rmSync(DB_PATH, { force: true })
  rmSync(DB_PATH + '-journal', { force: true })
})

describe('retention report', () => {
  it('computes DAU, D1 cohorts, runs and ranked share from DailyRun rows', async () => {
    // window: 3 days ending 2026-11-13 (todayKey). 10s+ runs so nothing else
    // matters — stats does not plausibility-check, but keep rows realistic.
    const mk = (day: string, userId: string | null, name: string, score = 10) =>
      recordDailyRun(db, {
        game: 'stack', dateKey: day, userId, name,
        score, durationMs: 30_000, seedUsed: 1, ranked: true, pending: false, inputLog: null,
      })
    // day 11: A(=u1) + GUEST B + GUEST C — B returns on day 13
    await mk('2026-11-11', 'u1', 'ALPHA')
    await mk('2026-11-11', null, 'BRAVO')
    await mk('2026-11-11', null, 'CHARLIE')
    // day 12: u2 only, never returns
    await mk('2026-11-12', 'u2', 'BRAVO2')
    // day 13 (today): ALPHA returns + DELTA is new; one UNRANKED run
    await mk('2026-11-13', 'u1', 'ALPHA')
    await mk('2026-11-13', null, 'DELTA')
    await recordDailyRun(db, {
      game: 'stack', dateKey: '2026-11-13', userId: null, name: 'ECHO',
      score: 5, durationMs: 30_000, seedUsed: 1, ranked: false, pending: false, inputLog: null,
    })

    const report = await retentionReport(db, { tz: 'Asia/Kolkata', todayKey: '2026-11-13', days: 3 })
    expect(report.tz).toBe('Asia/Kolkata')
    const byDay = new Map(report.days.map((d) => [d.dateKey, d]))
    // day 11: 3 players, 1 (BRAVO by name) returned later → 33%
    expect(byDay.get('2026-11-11')).toMatchObject({ players: 3, returning: 1 })
    expect(byDay.get('2026-11-11')?.d1).toBe(33)
    // day 12: 1 player, 0 returned
    expect(byDay.get('2026-11-12')).toMatchObject({ players: 1, returning: 0, d1: 0 })
    // day 13 (today): 3 players (ALPHA, DELTA, ECHO — unranked still counts
    // as activity), 0 "later" days → 0%
    expect(byDay.get('2026-11-13')?.players).toBe(3)
    // runs: 7 total, 6 ranked → 86%
    expect(report.totals.runsTotal).toBe(7)
    expect(report.totals.rankedShare).toBe(86)
    // avg DAU over 3 days: (3+1+3)/3 = 2.33 → 2
    expect(report.totals.avgDau).toBe(2)
    expect(report.totals.bestDau).toBe(3)
    expect(report.totals.bestDauDate).toBe('2026-11-11')
  })

  it('empty window reports zeros, never throws', async () => {
    const report = await retentionReport(db, { tz: 'UTC', todayKey: '2026-01-01', days: 7 })
    expect(report.totals.avgDau).toBe(0)
    expect(report.totals.runsTotal).toBe(0)
    expect(report.totals.rankedShare).toBe(0)
    expect(report.days).toHaveLength(7)
  })

  it('pending/removed runs never count as activity', async () => {
    await recordDailyRun(db, {
      game: 'stack', dateKey: '2026-02-05', userId: 'u1', name: 'ALPHA',
      score: 9, durationMs: 30_000, seedUsed: 1, ranked: true, pending: true, inputLog: null,
    })
    const report = await retentionReport(db, { tz: 'UTC', todayKey: '2026-02-07', days: 3 })
    const day = report.days.find((d) => d.dateKey === '2026-02-05')
    expect(day?.players).toBe(0) // pending → invisible
  })
})
