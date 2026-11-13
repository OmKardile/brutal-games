// Daily seed derivation — SERVER ONLY.
//
// Seed = hash(slug + ':' + dateKey + ':' + DAILY_SALT). Everyone gets the same
// seed for a game on a given day; the salt is server-side and never sent to
// the client (only the derived seed is, and it is public by design).
//
// The seed feeds the game's rng via the shim (seeded Math.random injection)
// and the kit's createRngKit for kit-native games. The hash is the same
// FNV-1a used by game-kit/rng so client and server agree bit-for-bit.

import { hashString } from '@/game-kit/rng'

let warned = false

/** Server salt. Prefer DAILY_SALT; fall back to SESSION_SECRET; final dev fallback warns. */
function dailySalt(): string {
  const salt = process.env.DAILY_SALT || process.env.SESSION_SECRET
  if (salt && salt.length >= 8) return salt
  if (!warned) {
    warned = true
    console.warn(
      '[daily] DAILY_SALT (or SESSION_SECRET) is unset/short — using an insecure dev salt. ' +
        'Set DAILY_SALT in production or daily seeds are predictable.',
    )
  }
  return 'insecure-dev-salt'
}

export function dailySeedFor(slug: string, dateKey: string): number {
  return hashString(`${slug}:${dateKey}:${dailySalt()}`)
}

/**
 * Verify a client-reported seed matches today's authoritative seed.
 * (Used when recording runs: a mismatch ⇒ ranked=false, marked on the board.)
 */
export function seedMatches(slug: string, dateKey: string, seed: number): boolean {
  return dailySeedFor(slug, dateKey) === seed
}
