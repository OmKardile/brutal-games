// Game registry — the single source of truth for what games exist.
//
// Server-safe: imported by API routes (daily plausibility), the sitemap, hub
// and category pages. Contains NO engine imports — those are lazy-loaded in
// the browser (see components/portal/GameStage) so game bundles never ship to
// portal pages that don't need them.

import { manifest as arenaManifest } from './arena/manifest'
import { manifest as stackManifest } from './stack/manifest'
import { manifest as reflexManifest } from './reflex/manifest'
import { manifest as dodgeManifest } from './dodge/manifest'
import { manifest as mergeManifest } from './merge/manifest'
import type { GameGenre, GameManifest, GameSlug } from './types'
import { GENRES } from './types'

export const GAMES: GameManifest[] = [
  arenaManifest,
  stackManifest,
  reflexManifest,
  dodgeManifest,
  mergeManifest,
]

export const GAME_SLUGS: GameSlug[] = GAMES.map((g) => g.slug)

export function getGame(slug: string): GameManifest | null {
  return GAMES.find((g) => g.slug === slug) ?? null
}

export function gamesByGenre(genre: GameGenre): GameManifest[] {
  return GAMES.filter((g) => g.genre === genre)
}

export const GENRE_LIST = Object.keys(GENRES) as GameGenre[]

/** Related games: same genre first, then the rest — used on game pages. */
export function relatedGames(slug: GameSlug, max = 3): GameManifest[] {
  const self = getGame(slug)
  if (!self) return GAMES.slice(0, max)
  const sameGenre = GAMES.filter((g) => g.slug !== slug && g.genre === self.genre)
  const others = GAMES.filter((g) => g.slug !== slug && g.genre !== self.genre)
  return [...sameGenre, ...others].slice(0, max)
}

/** Board display order (landing/hub tabs use the same order). */
export function boardGames(): GameManifest[] {
  return GAMES
}
