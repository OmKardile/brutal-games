// Run sessions + heartbeat validation. Hardening rules:
//   - server-side timestamps only (client never sends times)
//   - beats faster than HEARTBEAT_INTERVAL_SEC * 0.75 are rejected
//   - beats must carry a per-run token (only its hash is stored; the token
//     itself is 32 random bytes from the CSPRNG — no Math.random/Date.now)
//   - a session expires after 30 min without a beat, caps at 240 beats (2h)
//   - only one open session per user; starting a new one aborts the old
//   - score submission claims the session via scoreClaimedAt (single-use for
//     ranked posts, independent of the rewards run-end which sets endedAt)

import { createHash, randomBytes } from 'node:crypto'
import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
import type { RewardSettings } from '@/lib/rewards/config'
import { awardPoints, todayProgress, type DB } from '@/lib/rewards/points'

const SESSION_IDLE_EXPIRY_MS = 30 * 60_000
const MAX_BEATS_PER_SESSION = 240

export interface StartResult {
  token: string
  intervalSec: number
}

export async function startPlaySession(
  userId: string,
  game: string | null,
  settings: RewardSettings,
  ip: string,
  dbx: DB = defaultDb,
): Promise<StartResult> {
  // single open session per user — a new run aborts the previous
  await dbx.playSession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date(), endedReason: 'ABORTED' },
  })
  // CSPRNG token (H4 fix): 32 random bytes, never derived from Math.random
  const token = randomBytes(32).toString('hex')
  // store hash of token; the raw token goes to the client only
  const stored = createHash('sha256').update(token).digest('hex')
  await dbx.playSession.create({
    data: { userId, tokenHash: stored, game, ip },
  })
  return { token, intervalSec: settings.HEARTBEAT_INTERVAL_SEC }
}

export type BeatCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ENDED'
  | 'TOO_FAST'
  | 'NOT_ACTIVE' // tab hidden or no input — no points this beat

export type BeatResult =
  | { ok: true; points: number; active: boolean; todayEarned: number; todayCap: number; beats: number }
  | { ok: false; code: BeatCode }

/** Pure: is this beat fast enough after the previous one? */
export function beatAllowed(
  lastBeatMs: number,
  nowMs: number,
  intervalSec: number,
): boolean {
  return nowMs - lastBeatMs >= intervalSec * 750
}

export async function processHeartbeat(
  userId: string,
  settings: RewardSettings,
  user: { id: string; status: string; adultDeclaredAt: Date | null },
  payload: { token: string; visible: boolean; inputEvents: number },
  now: Date = new Date(),
  dbx: PrismaClient | DB = defaultDb,
): Promise<BeatResult> {
  const tokenHash = createHash('sha256').update(payload.token).digest('hex')
  const session = await dbx.playSession.findUnique({ where: { tokenHash } })
  if (!session || session.userId !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (session.endedAt) return { ok: false, code: 'SESSION_ENDED' }

  const last = (session.lastBeatAt ?? session.startedAt).getTime()
  if (now.getTime() - last > SESSION_IDLE_EXPIRY_MS) {
    await dbx.playSession.update({
      where: { id: session.id },
      data: { endedAt: now, endedReason: 'EXPIRED' },
    })
    return { ok: false, code: 'SESSION_ENDED' }
  }
  if (!beatAllowed(last, now.getTime(), settings.HEARTBEAT_INTERVAL_SEC)) {
    return { ok: false, code: 'TOO_FAST' }
  }
  if (session.beats >= MAX_BEATS_PER_SESSION) {
    await dbx.playSession.update({
      where: { id: session.id },
      data: { endedAt: now, endedReason: 'EXPIRED' },
    })
    return { ok: false, code: 'SESSION_ENDED' }
  }

  const active = payload.visible && payload.inputEvents > 0
  const beatNo = session.beats + 1

  if (!active) {
    // keep the session alive, count the beat, but no points, no activity time
    await dbx.playSession.update({
      where: { id: session.id },
      data: { lastBeatAt: now, beats: beatNo },
    })
    const prog = await todayProgress(userId, settings, dbx as DB)
    return { ok: true, points: 0, active: false, todayEarned: prog.earned, todayCap: prog.cap, beats: beatNo }
  }

  const award = await awardPoints(
    { settings, user, now },
    {
      userId,
      points: settings.HEARTBEAT_POINTS,
      reason: 'PLAY_TIME',
      idempotencyKey: `hb:${session.id}:${beatNo}`,
      meta: { beat: beatNo },
    },
    dbx as DB,
  )

  await dbx.playSession.update({
    where: { id: session.id },
    data: {
      lastBeatAt: now,
      beats: beatNo,
      // credit the nominal interval; real drift is deliberately ignored
    },
  })
  await dbx.dailyActivity.update({
    where: { userId_date: { userId, date: istKey(now) } },
    data: { heartbeats: { increment: 1 }, activitySeconds: { increment: settings.HEARTBEAT_INTERVAL_SEC } },
  }).catch(() => undefined)

  const prog = await todayProgress(userId, settings, dbx as DB)
  const points = award.kind === 'awarded' ? award.points : 0
  return { ok: true, points, active: true, todayEarned: prog.earned, todayCap: prog.cap, beats: beatNo }
}

function istKey(now: Date): string {
  const d = new Date(now.getTime() + 5.5 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export async function findOpenSession(
  userId: string,
  token: string,
  dbx: DB = defaultDb,
) {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await dbx.playSession.findUnique({ where: { tokenHash } })
  if (!session || session.userId !== userId) return null
  return session
}

export type ScoreClaimCode =
  | 'SESSION_NOT_FOUND'
  | 'ALREADY_SCORED'
  | 'GAME_MISMATCH'

export type ScoreClaimResult =
  | { ok: true; session: { id: string; startedAt: Date }; durationSec: number }
  | { ok: false; code: ScoreClaimCode }

/**
 * Claim a run session for a ranked score submission (single-use).
 * Order-independent with the rewards run-end: a session already ended with
 * RUN_END can still be scored once; a session scored by run-end but not yet
 * score-claimed still validates here.
 */
export async function claimScoreForSession(
  userId: string,
  token: string,
  game: string,
  dbx: DB = defaultDb,
  now: Date = new Date(),
): Promise<ScoreClaimResult> {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await dbx.playSession.findUnique({ where: { tokenHash } })
  if (!session || session.userId !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (session.game && session.game !== game) return { ok: false, code: 'GAME_MISMATCH' }
  if (session.scoreClaimedAt) return { ok: false, code: 'ALREADY_SCORED' }
  // ABORTED (superseded by a newer run) or long-idle sessions don't count
  if (session.endedAt && session.endedReason === 'ABORTED') return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (session.endedAt && session.endedReason === 'EXPIRED') return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (now.getTime() - session.startedAt.getTime() > 24 * 3600_000) {
    return { ok: false, code: 'SESSION_NOT_FOUND' }
  }

  await dbx.playSession.update({
    where: { id: session.id },
    data: { scoreClaimedAt: now },
  })
  const durationSec = (now.getTime() - session.startedAt.getTime()) / 1000
  return { ok: true, session: { id: session.id, startedAt: session.startedAt }, durationSec }
}

export async function endPlaySession(
  sessionId: string,
  reason: 'RUN_END' | 'ABORTED',
  dbx: DB = defaultDb,
): Promise<void> {
  await dbx.playSession
    .update({
      where: { id: sessionId },
      data: { endedAt: new Date(), endedReason: reason },
    })
    .catch(() => undefined)
}
