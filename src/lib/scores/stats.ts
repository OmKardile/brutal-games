// Statistical anomaly detection for score submissions — anti-cheat
// Layer C (phase 3). FLAG-ONLY: anomalies open a FraudFlag for review;
// they never auto-reject an entry (false positives cost more than leakage at
// current caps — ADR-020).

import type { PrismaClient } from '@prisma/client'
import { flagUser } from '@/lib/rewards/fraud'

export type AnomalyLevel = 'ok' | 'watch' | 'anomaly'

export interface AnomalyStats {
  ownMax: number | null
  ownSamples: number
  populationMean: number
  populationStd: number
  z: number | null
}

export interface AnomalyVerdict {
  level: AnomalyLevel
  stats: AnomalyStats
}

const OWN_HISTORY_MIN = 5
const POPULATION_SAMPLE = 500

/** Pure: classify a score against own history + population statistics. */
export function classifyScore(
  score: number,
  own: { max: number | null; samples: number },
  population: { mean: number; std: number },
): AnomalyVerdict {
  const z = population.std > 0 ? (score - population.mean) / population.std : null
  const stats: AnomalyStats = {
    ownMax: own.max,
    ownSamples: own.samples,
    populationMean: population.mean,
    populationStd: population.std,
    z,
  }
  // need a baseline before flagging — new players can legitimately pop off
  if (own.samples < OWN_HISTORY_MIN) return { level: 'ok', stats }
  const overOwn = own.max !== null && own.max > 0 ? score / own.max : null
  if (z !== null && z >= 5 && overOwn !== null && overOwn >= 3) {
    return { level: 'anomaly', stats }
  }
  if ((z !== null && z >= 3) || (overOwn !== null && overOwn >= 2)) {
    return { level: 'watch', stats }
  }
  return { level: 'ok', stats }
}

/**
 * Evaluate a ranked score against the player's own history and the game's
 * population; raise a review flag when anomalous. Never throws into the
 * submission path.
 */
export async function checkScoreAnomaly(
  userId: string,
  game: string,
  score: number,
  dbx: PrismaClient,
): Promise<AnomalyVerdict | null> {
  try {
    const [ownRows, popRows] = await Promise.all([
      dbx.highScore.findMany({
        where: { userId, game, ranked: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { score: true },
      }),
      dbx.highScore.findMany({
        where: { game, ranked: true },
        orderBy: { createdAt: 'desc' },
        take: POPULATION_SAMPLE,
        select: { score: true },
      }),
    ])
    const ownMax = ownRows.length > 0 ? Math.max(...ownRows.map((r) => r.score)) : null
    const mean = popRows.length > 0 ? popRows.reduce((s, r) => s + r.score, 0) / popRows.length : 0
    const variance = popRows.length > 1
      ? popRows.reduce((s, r) => s + (r.score - mean) ** 2, 0) / (popRows.length - 1)
      : 0
    const verdict = classifyScore(
      score,
      { max: ownMax, samples: ownRows.length },
      { mean, std: Math.sqrt(variance) },
    )
    if (verdict.level === 'anomaly') {
      await flagUser(userId, 'ANOMALY', 'MEDIUM', {
        check: 'score_statistical_outlier',
        score,
        z: verdict.stats.z !== null ? Number(verdict.stats.z.toFixed(2)) : null,
        ownMax: verdict.stats.ownMax,
        ownSamples: verdict.stats.ownSamples,
        populationMean: Math.round(verdict.stats.populationMean),
      }, dbx)
    } else if (verdict.level === 'watch') {
      await flagUser(userId, 'ANOMALY', 'LOW', {
        check: 'score_statistical_watch',
        score,
        z: verdict.stats.z !== null ? Number(verdict.stats.z.toFixed(2)) : null,
        ownMax: verdict.stats.ownMax,
      }, dbx)
    }
    return verdict
  } catch {
    return null // statistics must never block a submission
  }
}
