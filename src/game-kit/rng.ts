// game-kit — seeded pseudo-random number generation.
//
// Determinism contract: gameplay logic draws ONLY from `logic`; cosmetic effects
// (particles, shake jitter, pure eye-candy) draw from `cosmetic`. The two streams
// are derived from one seed but never share state, so making pretty things pretty
// can never desync a run. No game logic may call Math.random (QA-enforced).
//
// Algorithms: mulberry32 (fast, tiny, good-enough distribution for games) and a
// 32-bit FNV-1a string hash for deriving seeds from strings like
// "stack:2026-11-13:salt".

export type RngStream = () => number // uniform float in [0, 1)

/** 32-bit FNV-1a string hash (deterministic across runtimes). */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 PRNG — returns a stream of floats in [0, 1). */
export function mulberry32(seed: number): RngStream {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** float in [min, max) */
export function rngRange(rng: RngStream, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** integer in [min, max] inclusive */
export function rngInt(rng: RngStream, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1))
}

export function rngPick<T>(rng: RngStream, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

/** true with probability p (0..1) */
export function rngChance(rng: RngStream, p: number): boolean {
  return rng() < p
}

/**
 * Two independent streams derived from one seed.
 * `logic` drives gameplay; `cosmetic` drives pure eye-candy. Same seed ⇒ same
 * logic sequence regardless of how much cosmetic randomness was consumed.
 */
export interface RngKit {
  seed: number
  logic: RngStream
  cosmetic: RngStream
}

export function createRngKit(seed: number): RngKit {
  // split the 32-bit seed space: logic uses seed directly, cosmetic uses a
  // large odd offset so the streams start far apart in sequence space.
  return {
    seed: seed >>> 0,
    logic: mulberry32(seed >>> 0),
    cosmetic: mulberry32((seed ^ 0x9e3779b9) >>> 0),
  }
}

/** Convenience: seed kit straight from a string (e.g. `${slug}:${dateKey}:${salt}`). */
export function createRngKitFromString(str: string): RngKit {
  return createRngKit(hashString(str))
}
