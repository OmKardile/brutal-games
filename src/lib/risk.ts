// Explainable risk scoring — anti-cheat Layer F (phase 4).
//
// Combines the fraud-signal inventory (FraudFlags) into a single score with
// per-reason breakdown:
//   LOW    (0-14)  normal — nothing happens
//   MEDIUM (15-39) manual review — the flags queue (nothing automated)
//   HIGH   (40+)   auto-HOLD — new ranked entries are stored pending
//                  verification, payout requests are blocked pending review.
//                  NEVER a ban, NEVER voiding without a human (ADR-020).
// Every reason is logged: the assessment returns the full breakdown, and
// consumers store it in flag details / response payloads.

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface RiskReason {
  code: string // flag type / signal name
  severity: string
  points: number
}

export interface RiskAssessment {
  score: number
  level: RiskLevel
  reasons: RiskReason[]
}

/** Points per flag severity. Confirmed flags weigh double. */
const SEVERITY_POINTS: Record<string, number> = { LOW: 3, MEDIUM: 10, HIGH: 25 }
const CONFIRMED_MULTIPLIER = 2

export const HIGH_BAND = 40
export const MEDIUM_BAND = 15

/** Pure: score + level from a flag inventory. */
export function scoreFromFlags(
  flags: { type: string; severity: string; status: string }[],
): RiskAssessment {
  const reasons: RiskReason[] = []
  const seen = new Map<string, RiskReason>()
  for (const f of flags) {
    if (f.status === 'DISMISSED') continue
    const base = SEVERITY_POINTS[f.severity] ?? 3
    const points = f.status === 'CONFIRMED' ? base * CONFIRMED_MULTIPLIER : base
    // one reason per flag type — keep the heaviest
    const prev = seen.get(f.type)
    if (!prev || prev.points < points) {
      const reason: RiskReason = { code: f.type, severity: f.severity, points }
      seen.set(f.type, reason)
    }
  }
  for (const r of seen.values()) reasons.push(r)
  const score = reasons.reduce((s, r) => s + r.points, 0)
  const level: RiskLevel = score >= HIGH_BAND ? 'HIGH' : score >= MEDIUM_BAND ? 'MEDIUM' : 'LOW'
  return { score, level, reasons: reasons.sort((a, b) => b.points - a.points) }
}

/** Assessment for a user from their OPEN/REVIEWING/CONFIRMED flags. */
export async function userRisk(
  userId: string,
  dbx: PrismaClient = defaultDb,
): Promise<RiskAssessment> {
  const flags = await dbx.fraudFlag.findMany({
    where: { userId, status: { in: ['OPEN', 'REVIEWING', 'CONFIRMED'] } },
    select: { type: true, severity: true, status: true },
  })
  return scoreFromFlags(flags)
}

/** True when the user has a CONFIRMED fraud flag (cheating adjudicated). */
export async function hasConfirmedFraud(
  userId: string,
  dbx: PrismaClient = defaultDb,
): Promise<boolean> {
  const n = await dbx.fraudFlag.count({ where: { userId, status: 'CONFIRMED' } })
  return n > 0
}
