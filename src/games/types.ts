// Game package contract — manifest types shared by every game package.
//
// A manifest is STATIC metadata (no imports of engine code): the portal,
// sitemap, SEO pages, daily API plausibility checks and the hub all read it.
// Server-safe (imported by API routes) — keep it dependency-free.

import type { AccentKey } from '@/game/theme'

export type GameSlug = 'arena' | 'stack' | 'reflex' | 'dodge' | 'merge'

/** portal categories (drives /games/category/[genre]) */
export type GameGenre = 'action' | 'skill' | 'puzzle'

export const GENRES: Record<GameGenre, { label: string; blurb: string }> = {
  action: {
    label: 'Action',
    blurb: 'Fast hands, faster enemies. Arena shooters and one-button gauntlets where every run escalates.',
  },
  skill: {
    label: 'Skill',
    blurb: 'One input, infinite depth. Timing and precision games that take ten seconds to learn and forever to master.',
  },
  puzzle: {
    label: 'Puzzle',
    blurb: 'Think, drop, chain. Physics puzzles where positioning beats panic and one move rewrites the board.',
  },
}

export interface GameManifest {
  slug: GameSlug
  /** full display title, e.g. 'BRUTAL//ARENA' */
  title: string
  /** short name for tabs/chips, e.g. 'ARENA' */
  shortName: string
  genre: GameGenre
  /** one-line hook for cards */
  tagline: string
  /** SEO meta description — MUST stay under 155 chars */
  metaDescription: string
  /** accent palette identity (src/game/theme.ts) */
  accent: AccentKey
  /** control descriptions for the how-to-play section */
  controlsDesktop: string
  controlsMobile: string
  controlsGamepad: string
  /** plausibility ceiling: no honest run scores more per second (grace applies server-side) */
  maxScorePerSecond: number
  /** plausibility floor: no honest run ends faster than this */
  minRunSeconds: number
  /** daily challenge support (seeded, ranked board) */
  dailyEnabled: boolean
  /** "last updated" shown on the game page (ISO date) */
  lastUpdated: string
}
