// Run sessions + heartbeat validation — anti-cheat Layers A/B (phase 3).
// Hardening rules:
//   - the run token is HMAC-signed (src/lib/run-token.ts): binds userId, game,
//     seed, nonce and the SERVER startedAt; forged/tampered tokens die offline
//   - server-side timestamps only (client never sends times)
//   - heartbeats carry a hash-chain response: each beat must echo
//     sha256(previous challenge); the challenge rotates every beat, so
//     replays and scripts that don't read responses fail (code BAD_CHALLENGE)
//   - beats faster than HEARTBEAT_INTERVAL_SEC * 0.75 are rejected
//   - a session expires after 30 min without a beat, caps at 240 beats (2h)
//   - only one open session per user; starting a new one aborts the old
//   - per-beat activity samples (inputEvents, rAF frames) are kept in beatLog:
//     * frame-rate drift vs server elapsed -> SPEED_HACK / HEADLESS flags
//     * identical non-zero input counts over >= 10 beats -> LOW_ENTROPY flag
//   - flags are review-only: nothing here auto-bans or auto-voids (ADR-020)
//   - score submission claims the session via scoreClaimedAt (single-use for
//     ranked posts, independent of the rewards run-end which sets endedAt)

import { createHash, randomBytes } from 'node:crypto'
import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
import type { RewardSettings } from '@/lib/rewards/config'
import { awardPoints, todayProgress, type DB } from '@/lib/rewards/points'
import { signRunToken, verifyRunToken } from '@/lib/run-token'
import { flagUser } from '@/lib/rewards/fraud'

const SESSION_IDLE_EXPIRY_MS = 30 * 60_000
const MAX_BEATS_PER_SESSION = 240
/** a scored session can be at most this old (too-late submissions rejected) */
const MAX_SCORABLE_SESSION_MS = 6 * 3600_000
const BEAT_LOG_MAX = 48

export interface StartResult {
  token: string
  intervalSec: number
  /** first heartbeat challenge — the client echoes sha256(challenge) on its next beat */
  challenge: string
}

export async function startPlaySession(
  userId: string,
  game: string | null,
  seed: number | null,
  settings: RewardSettings,
  ip: string,
  dbx: DB = defaultDb,
): Promise<StartResult> {
  // single open session per user — a new run aborts the previous
  await dbx.playSession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date(), endedReason: 'ABORTED' },
  })
  const startedAt = Date.now()
  // signed token: offline-verifiable, binds the run parameters
  const token = signRunToken({ uid: userId, game, seed, startedAt })
  const challenge = randomBytes(16).toString('hex')
  // store hash of token; the raw token goes to the client only
  const stored = createHash('sha256').update(token).digest('hex')
  await dbx.playSession.create({
    data: { userId, tokenHash: stored, game, seed, ip, challenge },
  })
  return { token, intervalSec: settings.HEARTBEAT_INTERVAL_SEC, challenge }
}

export type BeatCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ENDED'
  | 'TOO_FAST'
  | 'BAD_CHALLENGE'
  | 'NOT_ACTIVE' // tab hidden or no input — no points this beat

export type BeatResult =
  | {
      ok: true
      points: number
      active: boolean
      todayEarned: number
      todayCap: number
      beats: number
      /** next challenge — echo sha256(nextChallenge) on the following beat */
      nextChallenge: string
    }
  | { ok: false; code: BeatCode }

/** Pure: is this beat fast enough after the previous one? */
export function beatAllowed(
  lastBeatMs: number,
  nowMs: number,
  intervalSec: number,
): boolean {
  return nowMs - lastBeatMs >= intervalSec * 750
}

export interface BeatSample {
  i: number // input events since last beat
  f?: number // rAF frames rendered since run start (optional client signal)
}

/** Pure: >= N identical non-zero input counts = scripted farming signature. */
export function lowEntropyBeats(log: BeatSample[], n = 10): boolean {
  const active = log.filter((b) => b.i > 0).slice(-n)
  if (active.length < n) return false
  return active.every((b) => b.i === active[0].i)
}

/**
 * Pure: frame-rate drift vs server elapsed. Nominal 60fps.
 * Returns 'fast' (speed-hack signature), 'slow' (headless/no-render farm) or
 * null when within tolerance or not enough data.
 */
export function frameDrift(frames: number, elapsedSec: number): 'fast' | 'slow' | null {
  if (elapsedSec < 30 || frames <= 0) return null
  const fps = frames / elapsedSec
  if (fps > 1.6 * 60) return 'fast'
  if (fps < 8) return 'slow'
  return null
}

function parseBeatLog(raw: string | null): BeatSample[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? (arr as BeatSample[]).slice(-BEAT_LOG_MAX) : []
  } catch {
    return []
  }
}

export async function processHeartbeat(
  userId: string,
  settings: RewardSettings,
  user: { id: string; status: string; adultDeclaredAt: Date | null },
  payload: { token: string; visible: boolean; inputEvents: number; frames?: number; challengeResponse: string },
  now: Date = new Date(),
  dbx: PrismaClient | DB = defaultDb,
): Promise<BeatResult> {
  // offline verification first — forged/tampered tokens never touch the DB
  const parsed = verifyRunToken(payload.token)
  if (!parsed || parsed.uid !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }

  const tokenHash = createHash('sha256').update(payload.token).digest('hex')
  const session = await dbx.playSession.findUnique({ where: { tokenHash } })
  if (!session || session.userId !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (session.endedAt) return { ok: false, code: 'SESSION_ENDED' }

  // hash-chain nonce echo — replays / scripts that don't read responses fail
  if (!session.challenge) return { ok: false, code: 'BAD_CHALLENGE' }
  const expected = createHash('sha256').update(session.challenge).digest('hex')
  if (payload.challengeResponse !== expected) return { ok: false, code: 'BAD_CHALLENGE' }

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
  const nextChallenge = randomBytes(16).toString('hex')

  // activity sample bookkeeping (entropy + drift signals — flag-only)
  const log = parseBeatLog(session.beatLog)
  log.push({ i: payload.inputEvents, ...(payload.frames !== undefined ? { f: payload.frames } : {}) })
  const trimmed = log.slice(-BEAT_LOG_MAX)

  if (active) {
    if (lowEntropyBeats(trimmed)) {
      await flagUser(userId, 'ANOMALY', 'MEDIUM', {
        check: 'low_input_entropy',
        beats: trimmed.slice(-10).map((b) => b.i),
        sessionId: session.id,
      }, dbx as DB).catch(() => undefined)
    }
    const elapsedSec = (now.getTime() - session.startedAt.getTime()) / 1000
    const drift = frameDrift(payload.frames ?? 0, elapsedSec)
    if (drift === 'fast') {
      await flagUser(userId, 'ANOMALY', 'HIGH', {
        check: 'frame_time_drift_fast',
        fps: Math.round((payload.frames ?? 0) / elapsedSec),
        elapsedSec: Math.round(elapsedSec),
        sessionId: session.id,
      }, dbx as DB).catch(() => undefined)
    } else if (drift === 'slow') {
      await flagUser(userId, 'HEADLESS_SUSPECT', 'MEDIUM', {
        check: 'frame_time_drift_slow',
        fps: Math.round((payload.frames ?? 0) / elapsedSec),
        elapsedSec: Math.round(elapsedSec),
        sessionId: session.id,
      }, dbx as DB).catch(() => undefined)
    }
  }

  if (!active) {
    // keep the session alive, count the beat, but no points, no activity time
    await dbx.playSession.update({
      where: { id: session.id },
      data: { lastBeatAt: now, beats: beatNo, challenge: nextChallenge, beatLog: JSON.stringify(trimmed) },
    })
    const prog = await todayProgress(userId, settings, dbx as DB)
    return { ok: true, points: 0, active: false, todayEarned: prog.earned, todayCap: prog.cap, beats: beatNo, nextChallenge }
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
      challenge: nextChallenge,
      beatLog: JSON.stringify(trimmed),
      // credit the nominal interval; real drift is deliberately ignored
    },
  })
  await dbx.dailyActivity.update({
    where: { userId_date: { userId, date: istKey(now) } },
    data: { heartbeats: { increment: 1 }, activitySeconds: { increment: settings.HEARTBEAT_INTERVAL_SEC } },
  }).catch(() => undefined)

  const prog = await todayProgress(userId, settings, dbx as DB)
  const points = award.kind === 'awarded' ? award.points : 0
  return { ok: true, points, active: true, todayEarned: prog.earned, todayCap: prog.cap, beats: beatNo, nextChallenge }
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
  const parsed = verifyRunToken(token)
  if (!parsed || parsed.uid !== userId) return null
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await dbx.playSession.findUnique({ where: { tokenHash } })
  if (!session || session.userId !== userId) return null
  return session
}

export type ScoreClaimCode =
  | 'SESSION_NOT_FOUND'
  | 'ALREADY_SCORED'
  | 'GAME_MISMATCH'
  | 'SEED_MISMATCH'
  | 'STALE_SESSION'

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
  const parsed = verifyRunToken(token)
  if (!parsed || parsed.uid !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await dbx.playSession.findUnique({ where: { tokenHash } })
  if (!session || session.userId !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (parsed.game !== game) return { ok: false, code: 'GAME_MISMATCH' }
  if (session.scoreClaimedAt) return { ok: false, code: 'ALREADY_SCORED' }
  // ABORTED (superseded by a newer run) or long-idle sessions don't count
  if (session.endedAt && session.endedReason === 'ABORTED') return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (session.endedAt && session.endedReason === 'EXPIRED') return { ok: false, code: 'SESSION_NOT_FOUND' }
  // duration comes from the SIGNED payload — untamperable server clock
  const ageMs = now.getTime() - parsed.startedAt
  if (ageMs > MAX_SCORABLE_SESSION_MS) return { ok: false, code: 'STALE_SESSION' }

  await dbx.playSession.update({
    where: { id: session.id },
    data: { scoreClaimedAt: now },
  })
  const durationSec = Math.max(0, ageMs) / 1000
  return { ok: true, session: { id: session.id, startedAt: session.startedAt }, durationSec }
}

/**
 * Claim a run session for a RANKED DAILY submission: the token must bind the
 * exact server-issued daily seed for game+dateKey (the caller re-checks
 * seedMatches against the payload seed).
 */
export async function claimDailyScoreForSession(
  userId: string,
  token: string,
  expected: { game: string; seed: number },
  dbx: DB = defaultDb,
  now: Date = new Date(),
): Promise<ScoreClaimResult> {
  const parsed = verifyRunToken(token)
  if (!parsed || parsed.uid !== userId) return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (parsed.seed !== expected.seed) return { ok: false, code: 'SEED_MISMATCH' }
  return claimScoreForSession(userId, token, expected.game, dbx, now)
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
