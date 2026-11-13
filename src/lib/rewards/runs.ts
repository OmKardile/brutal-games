// Run-completion points with server-side plausibility checks. The client
// reports run stats, but the server only trusts its own PlaySession clock:
// rewards for a run require an open play session, and stats are rejected as
// implausible if they don't fit the server-measured session duration.

import type { RewardSettings } from '@/lib/rewards/config'
import { db } from '@/lib/db'
import { awardPoints, type DB } from '@/lib/rewards/points'
import { findOpenSession, endPlaySession } from '@/lib/rewards/heartbeat'
import { dailyChallengeFor, challengeMet, type DailyChallenge } from '@/lib/rewards/challenge'
import { flagUser } from '@/lib/rewards/fraud'

export interface RunStatsInput {
  score: number
  wave: number
  kills: number
  timeAlive: number // client-claimed seconds, sanity-checked
}

export interface RunAwardResult {
  ok: boolean
  code?: 'SESSION_NOT_FOUND' | 'IMPLAUSIBLE' | 'BLOCKED'
  runPoints: number
  challenge: DailyChallenge | null
  challengePoints: number
  challengeMetFlag: boolean
}

/** Pure: does this stat line fit a session of `serverDurationSec` seconds? */
export function statsPlausible(stats: RunStatsInput, serverDurationSec: number): boolean {
  if (stats.score < 0 || stats.wave < 0 || stats.kills < 0 || stats.timeAlive < 0) return false
  if (stats.timeAlive > serverDurationSec + 5) return false
  if (stats.wave > Math.floor(serverDurationSec / 15) + 1) return false // ≥15s per wave
  if (stats.kills > Math.floor(serverDurationSec * 5)) return false // ≤5 kills/sec
  if (stats.score > stats.kills * 600 + 1000) return false // bounded score/kill
  return true
}

/** Pure: run-completion points for a wave reached. */
export function runCompletionPoints(wave: number): number {
  if (wave < 1) return 0
  return Math.min(wave * 2, 30)
}

export async function awardRunCompletion(
  settings: RewardSettings,
  user: { id: string; status: string; adultDeclaredAt: Date | null; createdAt: Date },
  token: string,
  stats: RunStatsInput,
  dbx: DB = db,
): Promise<RunAwardResult> {
  const session = await findOpenSession(user.id, token, dbx)
  if (!session) {
    return { ok: false, code: 'SESSION_NOT_FOUND', runPoints: 0, challenge: null, challengePoints: 0, challengeMetFlag: false }
  }

  const serverDurationSec = (Date.now() - session.startedAt.getTime()) / 1000
  await endPlaySession(session.id, 'RUN_END', dbx)

  if (!statsPlausible(stats, serverDurationSec)) {
    await flagUser(user.id, 'ANOMALY', 'MEDIUM', {
      check: 'implausible_run_stats',
      stats,
      serverDurationSec: Math.round(serverDurationSec),
    }, dbx)
    return { ok: false, code: 'IMPLAUSIBLE', runPoints: 0, challenge: null, challengePoints: 0, challengeMetFlag: false }
  }

  const ctx = { settings, user, now: new Date() }
  let runPoints = 0
  const pts = runCompletionPoints(stats.wave)
  if (pts > 0) {
    const r = await awardPoints(ctx, {
      userId: user.id,
      points: pts,
      reason: 'RUN_COMPLETION',
      idempotencyKey: `run:${session.id}`,
      meta: { wave: stats.wave },
    }, dbx)
    if (r.kind === 'awarded') runPoints = r.points
  }

  // daily challenge — deterministic per IST date
  const challenge = dailyChallengeFor(new Date())
  const met = challengeMet(challenge, stats)
  let challengePoints = 0
  if (met) {
    const key = `challenge:${user.id}:${challenge.id}`
    const r = await awardPoints(ctx, {
      userId: user.id,
      points: settings.DAILY_CHALLENGE_POINTS,
      reason: 'DAILY_CHALLENGE',
      idempotencyKey: key,
      meta: { challenge: challenge.kind, target: challenge.target },
    }, dbx)
    if (r.kind === 'awarded') challengePoints = r.points
  }

  return { ok: true, runPoints, challenge, challengePoints, challengeMetFlag: met }
}
