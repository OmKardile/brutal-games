// Daily mutators — server-derived run modifiers (slice 1, ADR-029).
//
// A mutator is a SCORE-RULE twist layered on the daily run, derived
// deterministically from the same server-side seed hash machinery the daily
// seed itself uses. Nothing about it is client-trusted: the client only
// READS which mutator is active (to render the label + explain the board);
// the score transformation happens entirely in the engine SHIM's summary()
// (server-authoritative submission flow unchanged: /api/daily/run still gets
// the transformed score and validates it against per-mutator plausibility
// multipliers, which live in the game manifest).
//
// v1 mutators are score-rule twists, NOT physics twists: the engines are
// off-limits (house rule) and expose no tuning knobs, so "wind drift" or
// "low gravity" would require engine edits. Score rules get 80% of the
// novelty for 0 engine risk. Physics mutators arrive with the engine
// migration (roadmap phase H).

import { hashString } from '@/game-kit/rng'
import { festivalFor, FESTIVALS } from './festival'

export interface DailyMutator {
  /** stable machine id (stored in URLs/APIs, never localized) */
  id: string
  /** short display label shown on the banner/board */
  label: string
  /** one-line rule explanation for the runner + share text */
  rule: string
}

// ---------------------------------------------------------------- registry
// STACK v1 mutators. Scoring-reward or scoring-penalty twists that need only
// the run summary — no engine state.

export const STACK_MUTATORS: DailyMutator[] = [
  {
    id: 'none',
    label: 'CLASSIC',
    rule: 'Standard scoring — every block counts one.',
  },
  {
    id: 'perfect-heavy',
    label: 'PERFECT HEAVY',
    rule: 'Perfect drops are worth double on the board — slop drops count one.',
  },
  {
    id: 'streak-master',
    label: 'STREAK MASTER',
    rule: 'Best streak is the board currency — score rides your longest chain.',
  },
  {
    id: 'tall-tower',
    label: 'TALL TOWER',
    rule: 'Only the final height counts — perfects are their own reward.',
  },
  {
    id: 'combo-hunt',
    label: 'COMBO HUNT',
    rule: 'Perfects + best streak together — the all-round board.',
  },
]

const MUTATORS_BY_GAME: Record<string, DailyMutator[]> = {
  stack: STACK_MUTATORS,
}

const MUTATOR_IDS = new Set(STACK_MUTATORS.map((m) => m.id))

/** Games that have a mutator set (others render no mutator UI). */
export function gameHasMutators(slug: string): boolean {
  return slug in MUTATORS_BY_GAME
}

/** Look up a mutator by id (falls back to CLASSIC — server-side data wins). */
export function mutatorFor(slug: string, id: string | null | undefined): DailyMutator {
  const list = MUTATORS_BY_GAME[slug] ?? STACK_MUTATORS
  return list.find((m) => m.id === id && MUTATOR_IDS.has(id)) ?? list[0]
}

// ---------------------------------------------------------------- derivation

/**
 * Deterministically pick the day's mutator from the same hash family as the
 * daily seed. Everyone on the planet gets the same mutator for a game+day —
 * zero extra trust surface, zero storage (recomputed on demand).
 *
 * The classic `none` mutator is deliberately part of the rotation: most days
 * should feel normal, mutator days are the seasoning, not the meal.
 *
 * FESTIVAL OVERRIDE (roadmap slice 3): when a festival is active for the
 * dateKey, the festival's themed mutator wins for STACK — the seasonal event
 * replaces the plain rotation for the window's duration.
 */
export function mutatorIdFor(slug: string, dateKey: string): string {
  if (!(slug in MUTATORS_BY_GAME)) return 'none'
  if (slug === 'stack') {
    const festival = festivalFor(dateKey)
    if (festival) return festival.mutator.id
  }
  const hash = hashString(`${slug}:mutator:${dateKey}:daily`)
  return MUTATORS_BY_GAME[slug][hash % MUTATORS_BY_GAME[slug].length].id
}

/** Resolve any mutator id (base set OR festival set) to label + rule. */
export function mutatorMeta(slug: string, id: string): { label: string; rule: string } {
  if (slug === 'stack') {
    const festival = festivalForTodayFor(id)
    if (festival) return { label: festival.label, rule: festival.rule }
  }
  const m = mutatorFor(slug, id)
  return { label: m.label, rule: m.rule }
}

/** Find a festival mutator by id across all festivals (label/rule lookup). */
function festivalForTodayFor(id: string): { label: string; rule: string } | null {
  for (const f of FESTIVALS) {
    const hit = f.mutators.find((m) => m.id === id)
    if (hit) return { label: hit.label, rule: hit.rule }
  }
  return null
}

/**
 * Client-side score transformation for a mutator day. This MUST mirror the
 * shim's transform exactly (tests pin them together): the runner shows the
 * live mutator score while playing, and the shim's summary() — which feeds
 * the server submission — applies the same math.
 */
export function applyMutator(mutatorId: string, summary: { score: number; perfects: number; bestStreak: number }): number {
  switch (mutatorId) {
    case 'perfect-heavy':
      // double weight for perfect drops: score + perfects (score already
      // includes every dropped block; perfects ride on top)
      return summary.score + summary.perfects
    case 'streak-master':
      // the board currency is the best streak of the run (capped so boards
      // stay comparable — a 200-streak run already aced the day)
      return summary.bestStreak
    case 'tall-tower':
      // final height only: identical to score for STACK (score = blocks
      // stacked) — kept as an explicit case so the share text stays honest
      // and future games with different score shapes can differ here
      return summary.score
    case 'combo-hunt':
      // all-round: perfects + best streak, no raw height
      return summary.perfects + summary.bestStreak
    // ---- festival mutators (roadmap slice 3) — themed transforms ----
    case 'festival-diwali-lights':
      return summary.score + summary.perfects * 2
    case 'festival-diwali-rockets':
      return summary.score + summary.bestStreak * 3
    case 'festival-holi-colors':
      return summary.perfects + summary.bestStreak
    case 'festival-navratri-nine':
      // every 9th block double: floor(score/9) extra
      return summary.score + Math.floor(summary.score / 9)
    case 'festival-independence-tricolor':
      return summary.score + summary.perfects * 2
    case 'festival-ganesh-modak':
      return summary.score + summary.perfects * 2
    default:
      return summary.score
  }
}

/**
 * Per-mutator plausibility multiplier for a game manifest's
 * maxScorePerSecond. The run route multiplies the manifest ceiling by this
 * so a "perfect-heavy" day with doubled scoring does not flag honest runs
 * as cheaters (and, symmetrically, does not loosen the ceiling for classic
 * days: multiplier 1).
 */
export function mutatorPlausibilityMultiplier(mutatorId: string): number {
  switch (mutatorId) {
    case 'perfect-heavy':
      return 2
    case 'streak-master':
      // best-streak boards are inherently small numbers, but the ceiling
      // must stay generous for the few monsters who chain everything
      return 1
    case 'tall-tower':
      return 1
    case 'combo-hunt':
      return 2
    // festival mutators declare their own multipliers (festival.ts) —
    // read the canonical value so the two sources can never drift
    default: {
      const festival = FESTIVALS.flatMap((f) => f.mutators).find((m) => m.id === mutatorId)
      return festival?.multiplier ?? 1
    }
  }
}
