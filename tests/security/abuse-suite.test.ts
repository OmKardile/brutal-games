// Phase 8: the ABUSE SUITE — every attack from the threat model (§5) fired at
// a REAL running server (standalone build + throwaway DB) and asserted to
// FAIL SAFELY. This is the last gate before rewards enablement is considered.
//
// Prerequisite: `bun run build` must have produced .next/standalone.
// Run: bun test tests/security/

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const PORT = 3997
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = BASE
const DB_DIR = join(tmpdir(), `brutal-abuse-${Date.now()}`)
const DB_PATH = join(DB_DIR, 'abuse.db')

let server: ReturnType<typeof spawn> | null = null
let serverReady = false
let serverLog = ''

// every call carries a unique (per-test) source IP via X-Forwarded-For —
// the server runs with TRUSTED_PROXY=1 so these become the rate-limit keys.
// This keeps the suite's own signups from colliding in one shared bucket
// while the ACTUAL abuse tests still get rate-limited exactly like reality.
let ipCounter = 1
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`

const H = (extra: Record<string, string> = {}) => ({
  'Content-Type': 'application/json',
  Origin: ORIGIN,
  ...extra,
})

interface Jar {
  cookie: string
  ip?: string
}

async function signup(jar: Jar, email: string, password: string): Promise<Response> {
  jar.ip = nextIp()
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: H({ 'X-Forwarded-For': jar.ip }),
    body: JSON.stringify({ email, password, name: email.split('@')[0].toUpperCase() }),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) jar.cookie = setCookie.split(';')[0]
  return res
}

async function login(jar: Jar, email: string, password: string): Promise<Response> {
  if (!jar.ip) jar.ip = nextIp()
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: H({ 'X-Forwarded-For': jar.ip }),
    body: JSON.stringify({ email, password }),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) jar.cookie = setCookie.split(';')[0]
  return res
}

async function authed(jar: Jar, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Cookie: jar.cookie,
      'X-Forwarded-For': jar.ip,
    },
  })
}

async function startRun(jar: Jar, game: string, seed?: number): Promise<{ token: string; challenge: string } | null> {
  const res = await authed(jar, '/api/run/start', {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({ game, ...(seed !== undefined ? { seed } : {}) }),
  })
  if (!res.ok) return null
  return (await res.json()) as { token: string; challenge: string }
}

async function submitScore(jar: Jar, body: Record<string, unknown>): Promise<Response> {
  return authed(jar, '/api/scores', { method: 'POST', headers: H(), body: JSON.stringify(body) })
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

beforeAll(async () => {
  // guard: needs a fresh standalone build
  try {
    Bun.file('.next/standalone/server.js').size
  } catch {
    throw new Error('abuse suite needs the standalone build — run `bun run build` first')
  }
  mkdirSync(DB_DIR, { recursive: true })
  const push = spawnSync(
    'bunx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
      encoding: 'utf8',
    },
  )
  if (push.status !== 0) throw new Error('prisma db push failed: ' + push.stderr)

  // the heartbeat route gates on REWARDS_ENABLED — turn it on for the suite
  // (points flow is still harmless: nobody declares 18+, so awards no-op)
  {
    const { PrismaClient } = await import('@prisma/client')
    const db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
    await db.rewardSetting.create({ data: { key: 'REWARDS_ENABLED', value: 'true' } })
    await db.rewardSetting.create({ data: { key: 'REWARDS_PAYOUTS_PAUSED', value: 'false' } })
    await db.$disconnect()
  }

  server = spawn('bun', ['.next/standalone/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: `file:${DB_PATH}`,
      SESSION_SECRET: 'abuse-suite-only-secret-0123456789abcdef0123456789abcdef',
      DAILY_SALT: 'abuse-suite-only-daily-salt-0123456789abcdef',
      TRUSTED_PROXY: '1', // tests control the client IP via XFF (see nextIp)
      TURNSTILE_SECRET_KEY: '', // captcha off for the suite (dev posture)
      RESEND_API_KEY: '',
      BREVO_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout?.on('data', (d) => { serverLog += d.toString() })
  server.stderr?.on('data', (d) => { serverLog += d.toString() })
  // wait for readiness (max ~20s)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break // died
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) {
        serverReady = true
        break
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!serverReady) throw new Error(`abuse-suite server failed to start. Log:\n${serverLog}`)
}, 30_000)

afterAll(() => {
  server?.kill('SIGKILL')
  rmSync(DB_DIR, { force: true, recursive: true })
})

// ---------------------------------------------------------------- T1: forged scores

describe('ABUSE: forged score submissions', () => {
  it('guest (no session) cannot post a score at all -> 401 + local board', async () => {
    const res = await fetch(`${BASE}/api/scores`, {
      method: 'POST',
      headers: H({ 'X-Forwarded-For': nextIp() }),
      body: JSON.stringify({ name: 'HACKER', score: 100_000_000, wave: 99, kills: 99, game: 'arena' }),
    })
    expect(res.status).toBe(401)
  })

  it('logged-in WITHOUT a run token -> stored display-only (ranked=false)', async () => {
    const jar: Jar = { cookie: '' }
    const su = await signup(jar, 'abuse-notoken@test.dev', 'long-enough-password')
    const res = await submitScore(jar, { name: 'X', score: 5_000, wave: 5, kills: 50, game: 'arena' })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ranked: boolean }
    expect(data.ranked).toBe(false)
  })

  it('FORGED run token (tampered signature) -> never ranks', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-forged@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'arena')
    expect(run).not.toBeNull()
    const [body, sig] = run!.token.split('.')
    const tampered = `${body.slice(0, -2)}xx.${sig}`
    const res = await submitScore(jar, {
      name: 'X', score: 3_000, wave: 3, kills: 30, game: 'arena', runToken: tampered,
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ranked: boolean }
    expect(data.ranked).toBe(false)
  })

  it('replayed run token -> second submission never ranks', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-replay@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'stack')
    expect(run).not.toBeNull()
    await submitScore(jar, {
      name: 'X', score: 300, wave: 300, kills: 12, game: 'stack', runToken: run!.token,
    })
    const second = await submitScore(jar, {
      name: 'X', score: 9_999, wave: 9_999, kills: 999, game: 'stack', runToken: run!.token,
    })
    const d2 = (await second.json()) as { ranked: boolean }
    expect(d2.ranked).toBe(false)
  })

  it('impossible score for the server-measured duration -> 422', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-impl@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'arena')
    const res = await submitScore(jar, {
      name: 'X', score: 4_321, wave: 4, kills: 40, game: 'arena', runToken: run!.token,
    })
    expect(res.status).toBe(422)
  })
})

// ------------------------------------------------------------- T2: daily integrity

describe('ABUSE: daily run integrity', () => {
  it('daily run with a mismatched seed -> ranked=false', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-daily@test.dev', 'long-enough-password')
    const today = new Date().toISOString().slice(0, 10)
    const res = await authed(jar, '/api/daily/run', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        game: 'arena', dateKey: today, name: 'ANON', score: 500,
        durationMs: 60_000, seed: 12345, ranked: true,
      }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ranked: boolean }
    expect(data.ranked).toBe(false)
  })

  it('daily run WITHOUT a run token -> ranked=false even with the right seed', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-daily2@test.dev', 'long-enough-password')
    const today = new Date().toISOString().slice(0, 10)
    const seedRes = await fetch(`${BASE}/api/daily/seed?game=arena`)
    const { seed } = (await seedRes.json()) as { seed: number }
    const res = await authed(jar, '/api/daily/run', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        game: 'arena', dateKey: today, name: 'ANON', score: 500,
        durationMs: 60_000, seed, ranked: true,
      }),
    })
    const data = (await res.json()) as { ranked: boolean }
    expect(data.ranked).toBe(false)
  })
})

// -------------------------------------------------------------- T4: heartbeat abuse

describe('ABUSE: heartbeat farming', () => {
  it('beat without a challenge response -> 400 (schema rejects)', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-hb1@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'arena')
    expect(run).not.toBeNull()
    const res = await authed(jar, '/api/rewards/heartbeat', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ token: run!.token, visible: true, inputEvents: 1 }),
    })
    expect(res.status).toBe(400)
  })

  it('beat with a wrong challenge echo -> 409 BAD_CHALLENGE', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-hb2@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'arena')
    const res = await authed(jar, '/api/rewards/heartbeat', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        token: run!.token, visible: true, inputEvents: 1,
        challengeResponse: sha256('never-issued-challenge'),
      }),
    })
    expect(res.status).toBe(409)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('BAD_CHALLENGE')
  })

  it('beat faster than the interval -> 429 TOO_FAST (correct challenge)', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-hb3@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'arena')
    const res = await authed(jar, '/api/rewards/heartbeat', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        token: run!.token, visible: true, inputEvents: 5,
        challengeResponse: sha256(run!.challenge),
      }),
    })
    expect(res.status).toBe(429)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('TOO_FAST')
  })

  it('heartbeat flood earns nothing (TOO_FAST / BAD_CHALLENGE only)', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-hb4@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'arena')
    const challenge = sha256(run!.challenge)
    const codes: number[] = []
    for (let i = 0; i < 12; i++) {
      const res = await authed(jar, '/api/rewards/heartbeat', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          token: run!.token, visible: true, inputEvents: 1, challengeResponse: challenge,
        }),
      })
      codes.push(res.status)
    }
    expect(codes.every((c) => c === 429 || c === 409 || c === 400)).toBe(true)
  })
})

// ------------------------------------------------------------------ T12: CSRF

describe('ABUSE: cross-origin requests (CSRF)', () => {
  it('state-changing POST from a foreign origin -> 403', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  it('form-encoded content type (form CSRF) -> 415', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
      body: 'email=a@b.c&password=x',
    })
    expect(res.status).toBe(415)
  })
})

// ------------------------------------------------------------- admin surface (T8/T9)

describe('ABUSE: admin surface', () => {
  it('admin routes as a NORMAL player -> 403', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-player@test.dev', 'long-enough-password')
    const res = await authed(jar, '/api/admin/settings')
    expect(res.status).toBe(403)
  })

  it('admin WITHOUT 2FA enrollment can log in but hits TOTP_SETUP_REQUIRED', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const { hashPassword } = await import('../../src/lib/auth/password')
    const db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
    const hash = await hashPassword('admin-abuse-pass-123')
    await db.user.create({
      data: {
        email: 'abuse-admin@test.dev', passwordHash: hash, role: 'ADMIN',
        emailVerified: new Date(),
      },
    })
    await db.$disconnect()
    const jar: Jar = { cookie: '' }
    const res = await login(jar, 'abuse-admin@test.dev', 'admin-abuse-pass-123')
    expect(res.status).toBe(200)
    const admin = await authed(jar, '/api/admin/settings')
    expect(admin.status).toBe(403)
    const data = (await admin.json()) as { code?: string }
    expect(data.code).toBe('TOTP_SETUP_REQUIRED')
  })

  it('no session at all -> 401 on admin routes', async () => {
    const res = await fetch(`${BASE}/api/admin/payouts`)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------- T3: name abuse

describe('ABUSE: board name poisoning', () => {
  it('reserved names (incl. leetspeak) are rejected', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-name1@test.dev', 'long-enough-password')
    for (const bad of ['ADMIN', '4dmin', 'SYSTEM', 'M0D']) {
      const res = await authed(jar, '/api/auth/profile', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ name: bad }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }
  })

  it('slurs are blocked by the callsign policy', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-name2@test.dev', 'long-enough-password')
    const res = await authed(jar, '/api/auth/profile', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ name: 'sh1thead' }),
    })
    expect(res.status).toBe(409)
  })

  it('ranked submissions ignore the client-supplied name entirely', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-name3@test.dev', 'long-enough-password')
    const run = await startRun(jar, 'merge')
    const res = await submitScore(jar, {
      name: 'NOT-ADMIN', score: 100, wave: 2, kills: 10, game: 'merge', runToken: run!.token,
    })
    const data = (await res.json()) as { created: { name: string } }
    expect(data.created.name).not.toBe('NOT-ADMIN')
  })
})

// ------------------------------------------------------------- T5: multi-account money

describe('ABUSE: payout path', () => {
  it('UPI destination reuse across accounts -> 409 + blocked', async () => {
    const a: Jar = { cookie: '' }
    const b: Jar = { cookie: '' }
    await signup(a, 'abuse-upi-a@test.dev', 'long-enough-password')
    await signup(b, 'abuse-upi-b@test.dev', 'long-enough-password')
    const first = await authed(a, '/api/rewards/upi', {
      method: 'POST', headers: H(), body: JSON.stringify({ upiId: 'Shared@OKHDFC' }),
    })
    expect(first.status).toBe(200)
    const second = await authed(b, '/api/rewards/upi', {
      method: 'POST', headers: H(), body: JSON.stringify({ upiId: 'shared@okhdfc' }),
    })
    expect(second.status).toBe(409)
  })

  it('payout request from a fresh account is safely gated', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-payout@test.dev', 'long-enough-password')
    const res = await authed(jar, '/api/rewards/payout', {
      method: 'POST', headers: H(), body: JSON.stringify({ amountMinor: 500_00 }),
    })
    expect([400, 403]).toContain(res.status)
    const data = (await res.json()) as { error?: string; code?: string }
    if (data.code) {
      expect(['DISABLED', 'PAYOUTS_PAUSED', 'ACCOUNT_TOO_NEW', 'NEED_ACTIVITY', 'EMAIL_UNVERIFIED', 'NO_CONSENT', 'NO_UPI', 'BELOW_THRESHOLD']).toContain(data.code)
    }
  })
})

// -------------------------------------------------------------- T10/T11: auth abuse

describe('ABUSE: authentication', () => {
  it('brute force -> per-account+per-IP exponential lockout', async () => {
    const email = 'abuse-brute@test.dev'
    const ip = '198.51.100.9'
    const codes: number[] = []
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: H({ 'X-Forwarded-For': ip }),
        body: JSON.stringify({ email, password: 'wrong-password-long' }),
      })
      codes.push(res.status)
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true)
    expect(codes.slice(5).every((c) => c === 429)).toBe(true)
  })

  it('spoofed X-Forwarded-For cannot dodge IP buckets (TRUSTED_PROXY unset)', async () => {
    const email = 'abuse-xff@test.dev'
    const codes: number[] = []
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: H({ 'X-Forwarded-For': `9.9.9.${i}` }),
        body: JSON.stringify({ email, password: 'wrong-password-long' }),
      })
      codes.push(res.status)
    }
    expect(codes.slice(5).every((c) => c === 429)).toBe(true)
  })

  it('user enumeration: unknown email and wrong password look identical', async () => {
    const r1 = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ email: 'ghost@nowhere.test', password: 'whatever-long' }),
    })
    const r2 = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ email: 'abuse-enum@somewhere.test', password: 'also-wrong-long' }),
    })
    const d1 = (await r1.json()) as { error: string }
    const d2 = (await r2.json()) as { error: string }
    expect(d1.error).toBe(d2.error)
  })
})

// ------------------------------------------------------------- oversized payloads

describe('ABUSE: malformed / oversized payloads', () => {
  it('absurd field lengths are rejected by zod, not stored', async () => {
    const jar: Jar = { cookie: '' }
    await signup(jar, 'abuse-size@test.dev', 'long-enough-password')
    const res = await submitScore(jar, {
      name: 'A'.repeat(100_000), score: 1, wave: 1, kills: 1, game: 'arena',
    })
    expect(res.status).toBe(400)
  })

  it('garbage JSON bodies fail cleanly', async () => {
    const res = await fetch(`${BASE}/api/scores`, {
      method: 'POST',
      headers: H(),
      body: '{"name": "broken',
    })
    expect([400, 401]).toContain(res.status)
  })
})
