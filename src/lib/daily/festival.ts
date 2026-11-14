// Festival calendar (roadmap slice 3, ADR-029) — India-first seasonal
// mutators + SEO pages.
//
// A festival is a date range (Gregorian) during which the STACK daily gets a
// themed bonus-mutator set instead of the plain rotation: the day's mutator
// is derived as festival→day-of-festival so every day inside a window feels
// like part of the event, and the label/emoji ride the UI + share texts.
//
// Design constraints (from the roadmap):
//   - NO real tournament / team / player names or logos (trademark).
//   - Dates are fixed Gregorian windows (moon-calendar festivals shift
//     year to year — the ranges below are the 2026 dates; bump them in
//     future years via FESTIVALS below, no schema change).
//   - Festival mutators are still SCORE RULES (engines untouched) with their
//     own plausibility multipliers — the anti-cheat math is unchanged.
//   - Zero storage: everything derives from dateKey at request time.

import { hashString } from '@/game-kit/rng'

export interface Festival {
  /** stable machine id */
  id: string
  /** display name (SEO page + banner) */
  name: string
  /** short banner tag */
  tag: string
  /** 'YYYY-MM-DD' inclusive window in the daily tz */
  start: string
  end: string
  /** themed bonus mutators (rotation inside the window) */
  mutators: FestivalMutator[]
  /** one-line theme for the SEO page + share text */
  blurb: string
}

export interface FestivalMutator {
  id: string
  label: string
  rule: string
  /** plausibility multiplier for the day's ceiling (>= 1) */
  multiplier: number
}

// themed mutators: festival-flavored score rules (STACK)
const DIWALI_MUTATORS: FestivalMutator[] = [
  {
    id: 'festival-diwali-lights',
    label: 'FESTIVAL OF LIGHTS',
    rule: 'Every perfect drop bursts double — perfects carry the board.',
    multiplier: 2,
  },
  {
    id: 'festival-diwali-rockets',
    label: 'ROCKET STREAKS',
    rule: 'Best streak counts triple weight with your height.',
    multiplier: 2,
  },
]

const HOLI_MUTATORS: FestivalMutator[] = [
  {
    id: 'festival-holi-colors',
    label: 'COLOR CHAOS',
    rule: 'Perfects + streak together — the all-color board.',
    multiplier: 2,
  },
]

const NAVRATRI_MUTATORS: FestivalMutator[] = [
  {
    id: 'festival-navratri-nine',
    label: 'NINE NIGHTS',
    rule: 'Every 9th block counts double — dance to the count.',
    multiplier: 2,
  },
]

const INDEPENDENCE_MUTATORS: FestivalMutator[] = [
  {
    id: 'festival-independence-tricolor',
    label: 'TRICOLOR RUN',
    rule: 'Perfects count double for the home crowd.',
    multiplier: 2,
  },
]

const GANESH_MUTATORS: FestivalMutator[] = [
  {
    id: 'festival-ganesh-modak',
    label: 'SWEET DROPS',
    rule: 'Perfect drops stack extra sweetness — perfects ×2 on the board.',
    multiplier: 2,
  },
]

/** Fixed-date festivals (2026 Gregorian windows) — bump per year. */
export const FESTIVALS: Festival[] = [
  {
    id: 'independence-day',
    name: 'Independence Day Run',
    tag: 'TRICOLOR',
    start: '2026-08-15',
    end: '2026-08-15',
    mutators: INDEPENDENCE_MUTATORS,
    blurb:
      'One day, one seed, the whole country: the tricolor daily challenge. Perfect drops count double on Independence Day.',
  },
  {
    id: 'ganesh-chaturthi',
    name: 'Ganesh Chaturthi Stacking',
    tag: 'MODAK',
    start: '2026-09-14',
    end: '2026-09-16',
    mutators: GANESH_MUTATORS,
    blurb:
      'Stack your own modak tower — a sweet-toothed daily challenge with perfect drops doubled.',
  },
  {
    id: 'navratri',
    name: 'Navratri Nine Nights',
    tag: 'GARBA',
    start: '2026-10-11',
    end: '2026-10-19',
    mutators: NAVRATRI_MUTATORS,
    blurb:
      'Nine nights of dandiya-paced stacking: every 9th block counts double. Keep the count, keep the streak.',
  },
  {
    id: 'diwali',
    name: 'Diwali Festival of Lights',
    tag: 'DIWALI',
    start: '2026-11-08',
    end: '2026-11-13',
    mutators: DIWALI_MUTATORS,
    blurb:
      'Light up the daily board: Diwali week runs special light-burst mutators — every perfect shines double.',
  },
  {
    id: 'christmas',
    name: 'Year-End Stack',
    tag: 'FESTIVE',
    start: '2026-12-24',
    end: '2026-12-31',
    mutators: HOLI_MUTATORS,
    blurb:
      'Close the year tall: the year-end daily runs color-chaos scoring all week.',
  },
  {
    id: 'holi',
    name: 'Holi Color Chaos',
    tag: 'HOLI',
    start: '2027-03-03',
    end: '2027-03-04',
    mutators: HOLI_MUTATORS,
    blurb:
      'The color festival throws everything at the board: perfects and streaks together on the all-color daily.',
  },
]

export interface FestivalDayInfo {
  festival: Festival
  mutator: FestivalMutator
  /** 1-based day inside the festival window (for "Day 3 of 6" copy) */
  dayIndex: number
  totalDays: number
}

function dateKeyLt(a: string, b: string): boolean {
  return a < b // ISO YYYY-MM-DD compares correctly lexicographically
}

/** The active festival on a dateKey, with that day's mutator (or null). */
export function festivalFor(dateKey: string): FestivalDayInfo | null {
  for (const festival of FESTIVALS) {
    if (dateKeyLt(dateKey, festival.start) || dateKeyLt(festival.end, dateKey)) continue
    // inside the window: pick the day's mutator deterministically
    const dayIndex = daysBetween(festival.start, dateKey) + 1
    const totalDays = daysBetween(festival.start, festival.end) + 1
    const hash = hashString(`festival:${festival.id}:${dateKey}`)
    const mutator = festival.mutators[hash % festival.mutators.length]
    return { festival, mutator, dayIndex, totalDays }
  }
  return null
}

/** All festivals overlapping a date range (the /daily/festivals page). */
export function festivalsInRange(fromKey: string, toKey: string): Festival[] {
  return FESTIVALS.filter((f) => !dateKeyLt(f.end, fromKey) && !dateKeyLt(toKey, f.start))
}

/** UTC calendar-day difference (both keys are YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}
