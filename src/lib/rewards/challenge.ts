// Daily challenge — deterministic per IST date (no randomness storage):
// every player worldwide gets the same challenge on the same day, and the
// award is idempotent per user per day (key challenge:{userId}:{date}).

import type { RunStatsInput } from '@/lib/rewards/runs'

export type ChallengeKind = 'WAVE' | 'KILLS' | 'SCORE'

export interface DailyChallenge {
  id: string // 'YYYY-MM-DD' (IST)
  kind: ChallengeKind
  target: number
  desc: string
}

const CHALLENGES: Array<{ kind: ChallengeKind; target: number; desc: (t: number) => string }> = [
  { kind: 'WAVE', target: 8, desc: (t) => `Reach wave ${t} in a single run` },
  { kind: 'KILLS', target: 250, desc: (t) => `Kill ${t} enemies in a single run` },
  { kind: 'SCORE', target: 12000, desc: (t) => `Score ${t.toLocaleString('en-IN')} in a single run` },
]

export function dailyChallengeFor(now: Date = new Date()): DailyChallenge {
  const d = new Date(now.getTime() + 5.5 * 3600_000)
  const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const ymd = Number(id.replaceAll('-', ''))
  const def = CHALLENGES[ymd % CHALLENGES.length]
  return { id, kind: def.kind, target: def.target, desc: def.desc(def.target) }
}

export function challengeMet(ch: DailyChallenge, stats: RunStatsInput): boolean {
  switch (ch.kind) {
    case 'WAVE':
      return stats.wave >= ch.target
    case 'KILLS':
      return stats.kills >= ch.target
    case 'SCORE':
      return stats.score >= ch.target
  }
}
