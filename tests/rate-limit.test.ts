// Phase 2: persistent (SQLite-backed) rate limiting + login lockout state.
// Runs against a REAL throwaway database; "restart persistence" is proven by
// constructing a second PrismaClient on the same file (fresh module state).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { limit, recordFailure, getLockout, clearFailures, LOGIN_LOCKOUT } from '../src/lib/rate-limit'

const DB_PATH = join(tmpdir(), `brutal-rl-test-${Date.now()}.db`)

let db: PrismaClient

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

describe('limit — sliding window', () => {
  it('allows up to max hits per window, then blocks with retry-after', async () => {
    const key = 't:window:1'
    for (let i = 0; i < 3; i++) {
      const r = await limit(key, 3, 60_000, db)
      expect(r.ok).toBe(true)
    }
    const blocked = await limit(key, 3, 60_000, db)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })
  it('uses independent buckets per key', async () => {
    const a = await limit('t:indep:a', 1, 60_000, db)
    const b = await limit('t:indep:b', 1, 60_000, db)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect((await limit('t:indep:a', 1, 60_000, db)).ok).toBe(false)
    expect((await limit('t:indep:b', 1, 60_000, db)).ok).toBe(false)
  })
})

describe('limit — persistence across restart', () => {
  it('keeps counting when a "new process" opens the same database', async () => {
    const key = 't:restart:1'
    // exhaust from client #1
    await limit(key, 2, 3600_000, db)
    await limit(key, 2, 3600_000, db)
    // simulate a restart: brand-new client + module state belongs to the old process
    const db2 = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
    const r = await limit(key, 2, 3600_000, db2)
    expect(r.ok).toBe(false) // the old in-memory Map would have forgotten this
    await db2.$disconnect()
  })
})

describe('lockout — recordFailure/getLockout/clearFailures', () => {
  it('stays unlocked below the threshold', async () => {
    const key = 't:lock:1'
    for (let i = 0; i < LOGIN_LOCKOUT.threshold - 1; i++) {
      const r = await recordFailure(key, LOGIN_LOCKOUT, db)
      expect(r.locked).toBe(false)
    }
    const state = await getLockout(key, LOGIN_LOCKOUT, db)
    expect(state.locked).toBe(false)
    expect(state.failCount).toBe(LOGIN_LOCKOUT.threshold - 1)
  })
  it('locks with backoff at the threshold and reports retryAfter', async () => {
    const key = 't:lock:2'
    for (let i = 0; i < LOGIN_LOCKOUT.threshold; i++) {
      await recordFailure(key, LOGIN_LOCKOUT, db)
    }
    const state = await getLockout(key, LOGIN_LOCKOUT, db)
    expect(state.locked).toBe(true)
    expect(state.retryAfterSec).toBeGreaterThan(0)
    expect(state.retryAfterSec).toBeLessThanOrEqual(Math.ceil(LOGIN_LOCKOUT.baseMs / 1000))
  })
  it('doubles the backoff as failures continue', async () => {
    const key = 't:lock:3'
    for (let i = 0; i < LOGIN_LOCKOUT.threshold + 1; i++) {
      await recordFailure(key, LOGIN_LOCKOUT, db)
    }
    const state = await getLockout(key, LOGIN_LOCKOUT, db)
    expect(state.locked).toBe(true)
    expect(state.retryAfterSec).toBeGreaterThan(Math.ceil(LOGIN_LOCKOUT.baseMs / 1000))
  })
  it('clearFailures resets the counter (login success path)', async () => {
    const key = 't:lock:4'
    for (let i = 0; i < LOGIN_LOCKOUT.threshold + 2; i++) {
      await recordFailure(key, LOGIN_LOCKOUT, db)
    }
    await clearFailures(key, db)
    const state = await getLockout(key, LOGIN_LOCKOUT, db)
    expect(state.locked).toBe(false)
    expect(state.failCount).toBe(0)
    // and one more failure starts a fresh count (not the old one)
    const next = await recordFailure(key, LOGIN_LOCKOUT, db)
    expect(next.failCount).toBe(1)
    expect(next.locked).toBe(false)
  })
  it('survives a restart too', async () => {
    const key = 't:lock:5'
    for (let i = 0; i < LOGIN_LOCKOUT.threshold; i++) {
      await recordFailure(key, LOGIN_LOCKOUT, db)
    }
    const db2 = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
    const state = await getLockout(key, LOGIN_LOCKOUT, db2)
    expect(state.locked).toBe(true)
    await db2.$disconnect()
  })
})
