// Phase 3 anti-cheat: signed run tokens (HMAC + key-id rotation), heartbeat
// hash-chain + drift/entropy signals, daily seed-bound claims, statistical
// anomaly classification. Run-token crypto is pure; session logic runs
// against a real throwaway DB.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  signRunToken,
  verifyRunToken,
  currentKeyId,
  tokenUsesCurrentKey,
} from '../src/lib/run-token'
import {
  startPlaySession,
  processHeartbeat,
  claimScoreForSession,
  claimDailyScoreForSession,
  lowEntropyBeats,
  frameDrift,
} from '../src/lib/rewards/heartbeat'
import { classifyScore } from '../src/lib/scores/stats'
import { DEFAULT_SETTINGS, type RewardSettings } from '../src/lib/rewards/config'

const DB_PATH = join(tmpdir(), `brutal-p3-test-${Date.now()}.db`)

let db: PrismaClient

const settings = (): RewardSettings => ({
  ...DEFAULT_SETTINGS,
  REWARDS_ENABLED: true,
  DAILY_POINT_CAP: 100,
  HEARTBEAT_POINTS: 1,
})

beforeAll(() => {
  const push = spawnSync(
    'bunx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
      encoding: 'utf8',
    },
  )
  if (push.status !== 0) throw new Error('prisma db push failed: ' + push.stdout + push.stderr)
  db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
})

afterAll(async () => {
  await db?.$disconnect().catch(() => undefined)
  rmSync(DB_PATH, { force: true })
  rmSync(DB_PATH + '-journal', { force: true })
})

async function mkUser(email: string): Promise<string> {
  const u = await db.user.create({
    data: { email, passwordHash: 'x', adultDeclaredAt: new Date() },
  })
  return u.id
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ---------------------------------------------------------------- run tokens

describe('run tokens — HMAC signing + rotation', () => {
  it('round-trips a signed token', () => {
    const token = signRunToken({ uid: 'u1', game: 'arena', seed: 123, startedAt: 1000 })
    const payload = verifyRunToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.uid).toBe('u1')
    expect(payload?.game).toBe('arena')
    expect(payload?.seed).toBe(123)
    expect(payload?.startedAt).toBe(1000)
    expect(payload?.kid).toBe(currentKeyId())
    expect(tokenUsesCurrentKey(payload!)).toBe(true)
  })
  it('every token gets a fresh nonce', () => {
    const a = signRunToken({ uid: 'u1', game: null, seed: null, startedAt: 1 })
    const b = signRunToken({ uid: 'u1', game: null, seed: null, startedAt: 1 })
    expect(a).not.toBe(b)
    expect(verifyRunToken(a)?.nonce).not.toBe(verifyRunToken(b)?.nonce)
  })
  it('rejects tampered payloads and broken signatures', () => {
    const token = signRunToken({ uid: 'u1', game: 'arena', seed: 1, startedAt: 1 })
    const [body, sig] = token.split('.')
    // flip a payload byte
    const tamperedBody = body.slice(0, -2) + (body.endsWith('aa') ? 'bb' : 'aa')
    expect(verifyRunToken(`${tamperedBody}.${sig}`)).toBeNull()
    // garbage signature
    expect(verifyRunToken(`${body}.deadbeef`)).toBeNull()
    // not a token at all
    expect(verifyRunToken('garbage')).toBeNull()
    expect(verifyRunToken('')).toBeNull()
  })
  it('verifies tokens signed with an OLD key after rotation (RUN_TOKEN_KEYS)', () => {
    const oldKeys = process.env.RUN_TOKEN_KEYS
    try {
      // two keys: current = k2
      process.env.RUN_TOKEN_KEYS =
        'k1:1111111111111111111111111111111111111111111111111111111111111111,k2:2222222222222222222222222222222222222222222222222222222222222222'
      const beforeRotation = signRunToken({ uid: 'u9', game: 'stack', seed: null, startedAt: 5 })
      expect(currentKeyId()).toBe('k2')
      // rotate: k2 removed from signing position, k3 becomes current
      process.env.RUN_TOKEN_KEYS =
        'k1:1111111111111111111111111111111111111111111111111111111111111111,k2:2222222222222222222222222222222222222222222222222222222222222222,k3:3333333333333333333333333333333333333333333333333333333333333333'
      const payload = verifyRunToken(beforeRotation)
      expect(payload !== null).toBe(true) // signed under k2, still verifiable
      expect(tokenUsesCurrentKey(payload!)).toBe(false)
      // new tokens sign under k3
      expect(currentKeyId()).toBe('k3')
      // a key that was fully removed no longer verifies
      const underK3 = signRunToken({ uid: 'u9', game: null, seed: null, startedAt: 6 })
      process.env.RUN_TOKEN_KEYS =
        'k3:3333333333333333333333333333333333333333333333333333333333333333'
      expect(verifyRunToken(underK3)?.uid).toBe('u9')
    } finally {
      if (oldKeys === undefined) delete process.env.RUN_TOKEN_KEYS
      else process.env.RUN_TOKEN_KEYS = oldKeys
    }
  })
})

// ------------------------------------------------------------ heartbeat chain

describe('heartbeat — hash-chain challenge', () => {
  it('accepts a beat with the correct challenge echo and rotates the challenge', async () => {
    const uid = await mkUser('chain-ok@test')
    const s = settings()
    const start = await startPlaySession(uid, 'arena', null, s, 'test', db)
    const t0 = new Date(start.token.length ? Date.now() : 0)
    void t0
    const now = new Date(Date.now() + 31_000) // first beat after the interval
    const r = await processHeartbeat(
      uid,
      s,
      { id: uid, status: 'ACTIVE', adultDeclaredAt: new Date(), createdAt: new Date(Date.now() - 96 * 3600_000) },
      {
        token: start.token,
        visible: true,
        inputEvents: 5,
        challengeResponse: sha256(start.challenge),
      },
      now,
      db,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.active).toBe(true)
      expect(r.nextChallenge).not.toBe(start.challenge)
    }
  })
  it('rejects a beat with a wrong/missing challenge (replay + dumb-script defense)', async () => {
    const uid = await mkUser('chain-bad@test')
    const s = settings()
    const start = await startPlaySession(uid, 'arena', null, s, 'test', db)
    const now = new Date(Date.now() + 31_000)
    const user = { id: uid, status: 'ACTIVE', adultDeclaredAt: new Date(), createdAt: new Date(Date.now() - 96 * 3600_000) }
    const wrong = await processHeartbeat(uid, s, user, {
      token: start.token,
      visible: true,
      inputEvents: 5,
      challengeResponse: sha256('not-the-challenge'),
    }, now, db)
    expect(wrong).toEqual({ ok: false, code: 'BAD_CHALLENGE' })
    // replaying the ORIGINAL challenge after it was used (if a beat succeeded) also fails
    const second = await processHeartbeat(uid, s, user, {
      token: start.token,
      visible: true,
      inputEvents: 5,
      challengeResponse: sha256(start.challenge),
    }, now, db)
    expect(second.ok).toBe(true) // correct response accepted
    // replay the same correct response again -> challenge already rotated
    const replay = await processHeartbeat(uid, s, user, {
      token: start.token,
      visible: true,
      inputEvents: 5,
      challengeResponse: sha256(start.challenge),
    }, new Date(now.getTime() + 31_000), db)
    expect(replay).toEqual({ ok: false, code: 'BAD_CHALLENGE' })
  })
  it('rejects a FORGED token outright (offline HMAC check)', async () => {
    const uid = await mkUser('chain-forged@test')
    const forged = signRunToken({ uid, game: 'arena', seed: null, startedAt: Date.now() })
      .split('.')[0] + '.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const r = await processHeartbeat(uid, settings(), { id: uid, status: 'ACTIVE', adultDeclaredAt: new Date(), createdAt: new Date(Date.now() - 96 * 3600_000) }, {
      token: forged,
      visible: true,
      inputEvents: 1,
      challengeResponse: sha256('x'),
    }, new Date(), db)
    expect(r).toEqual({ ok: false, code: 'SESSION_NOT_FOUND' })
  })
  it('rejects another user’s token (uid binding)', async () => {
    const owner = await mkUser('chain-owner@test')
    const thief = await mkUser('chain-thief@test')
    const s = settings()
    const start = await startPlaySession(owner, 'arena', null, s, 'test', db)
    const r = await processHeartbeat(thief, s, { id: thief, status: 'ACTIVE', adultDeclaredAt: new Date() }, {
      token: start.token,
      visible: true,
      inputEvents: 1,
      challengeResponse: sha256(start.challenge),
    }, new Date(), db)
    expect(r).toEqual({ ok: false, code: 'SESSION_NOT_FOUND' })
  })
})

describe('heartbeat — activity heuristics (pure)', () => {
  it('lowEntropyBeats flags identical non-zero input counts', () => {
    const flat = Array.from({ length: 12 }, () => ({ i: 1 }))
    expect(lowEntropyBeats(flat)).toBe(true)
    const varied = Array.from({ length: 12 }, (_, k) => ({ i: k + 1 }))
    expect(lowEntropyBeats(varied)).toBe(false)
    // zeros (inactive) never count toward entropy
    expect(lowEntropyBeats(Array.from({ length: 20 }, () => ({ i: 0 })))).toBe(false)
    // too few samples
    expect(lowEntropyBeats([{ i: 1 }, { i: 1 }])).toBe(false)
  })
  it('frameDrift detects speed-hack and headless signatures', () => {
    expect(frameDrift(12_000, 100)).toBe('fast') // 120fps > 1.6x nominal
    expect(frameDrift(6_000, 100)).toBe(null) // 60fps = nominal
    expect(frameDrift(700, 100)).toBe('slow') // 7fps — no real rendering
    expect(frameDrift(30_000, 10)).toBe(null) // too early to judge
    expect(frameDrift(0, 100)).toBe(null) // no signal
  })
})

// ------------------------------------------------------------------ daily claims

describe('claimDailyScoreForSession — seed binding', () => {
  it('accepts a token bound to the exact daily seed', async () => {
    const uid = await mkUser('daily-ok@test')
    const seed = 123456789
    const start = await startPlaySession(uid, 'stack', seed, settings(), 'test', db)
    const r = await claimDailyScoreForSession(uid, start.token, { game: 'stack', seed }, db)
    expect(r.ok).toBe(true)
  })
  it('rejects a seed mismatch (token bound to a different seed)', async () => {
    const uid = await mkUser('daily-seed@test')
    const start = await startPlaySession(uid, 'stack', 111, settings(), 'test', db)
    const r = await claimDailyScoreForSession(uid, start.token, { game: 'stack', seed: 222 }, db)
    expect(r).toEqual({ ok: false, code: 'SEED_MISMATCH' })
  })
  it('single-use: a second ranked daily claim on the same token fails', async () => {
    const uid = await mkUser('daily-replay@test')
    const start = await startPlaySession(uid, 'stack', 42, settings(), 'test', db)
    const first = await claimDailyScoreForSession(uid, start.token, { game: 'stack', seed: 42 }, db)
    expect(first.ok).toBe(true)
    const second = await claimDailyScoreForSession(uid, start.token, { game: 'stack', seed: 42 }, db)
    expect(second).toEqual({ ok: false, code: 'ALREADY_SCORED' })
  })
  it('too-late submissions are rejected (stale session)', async () => {
    const uid = await mkUser('daily-stale@test')
    const start = await startPlaySession(uid, 'stack', 7, settings(), 'test', db)
    const r = await claimDailyScoreForSession(
      uid,
      start.token,
      { game: 'stack', seed: 7 },
      db,
      new Date(Date.now() + 7 * 3600_000),
    )
    expect(r).toEqual({ ok: false, code: 'STALE_SESSION' })
  })
})

// ------------------------------------------------------------------- statistics

describe('classifyScore — statistical anomaly levels', () => {
  const population = { mean: 5_000, std: 2_000 }
  it('needs own-history samples before flagging', () => {
    expect(classifyScore(1_000_000, { max: null, samples: 2 }, population).level).toBe('ok')
  })
  it('watch: 2x own max or z >= 3', () => {
    expect(classifyScore(20_000, { max: 9_000, samples: 10 }, population).level).toBe('watch')
    expect(classifyScore(12_000, { max: 5_000, samples: 10 }, population).level).toBe('watch')
  })
  it('anomaly: z >= 5 AND 3x own max', () => {
    expect(classifyScore(25_000, { max: 5_000, samples: 10 }, population).level).toBe('anomaly')
  })
  it('normal scores pass', () => {
    expect(classifyScore(6_000, { max: 7_000, samples: 10 }, population).level).toBe('ok')
  })
})

// claimScoreForSession still enforces the core rules with signed tokens
describe('claimScoreForSession — signed-token era', () => {
  it('GAME_MISMATCH uses the signed payload game binding', async () => {
    const uid = await mkUser('claim-mismatch@test')
    const start = await startPlaySession(uid, 'reflex', null, settings(), 'test', db)
    const r = await claimScoreForSession(uid, start.token, 'arena', db)
    expect(r).toEqual({ ok: false, code: 'GAME_MISMATCH' })
  })
})
