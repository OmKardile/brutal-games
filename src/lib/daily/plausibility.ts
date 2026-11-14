// Plausibility checks for daily (and board) score submissions.
//
// Pure functions — unit-tested. These are SANITY ANCHORS against blatant
// fabrication (score 999,999,999 in 4 seconds), not precision instruments:
// the ceilings come from each game's manifest and are deliberately generous
// (a great player must never be rejected; a script kiddie must be).

import type { GameManifest } from '@/games/types'

export interface RunPayload {
  score: number
  durationMs: number
  /**
   * Per-mutator ceiling multiplier (roadmap slice 1): a double-scoring
   * mutator day must not flag honest runs. Defaults to 1 (classic days).
   */
  multiplier?: number
}

export type Verdict = { ok: true } | { ok: false; reason: string }

/** seconds of slack so fast legit runs (early death, quick rounds) pass */
const GRACE_SECONDS = 5

export function checkPlausibility(manifest: GameManifest, run: RunPayload): Verdict {
  if (run.durationMs < manifest.minRunSeconds * 1000) {
    return { ok: false, reason: `run shorter than ${manifest.minRunSeconds}s` }
  }
  const seconds = run.durationMs / 1000
  const ceiling = manifest.maxScorePerSecond * (seconds + GRACE_SECONDS) * (run.multiplier ?? 1)
  if (run.score > ceiling) {
    return { ok: false, reason: 'score implausible for duration' }
  }
  return { ok: true }
}
