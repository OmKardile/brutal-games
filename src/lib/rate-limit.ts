// Persistent rate limiting + login lockout. SQLite-backed (RateLimitBucket
// table) since 0.8 — survives restarts, replacing the pre-0.8 in-memory Map.
// A tiny write-through cache absorbs bursts of reads on the same key; the DB
// is the source of truth (a restart loses nothing).
//
// Two primitives:
//  - limit(key, max, windowMs)   sliding-window rate limit (all API buckets)
//  - recordFailure/getLockout/clearFailures(key)  consecutive-failure counter
//    with exponential backoff (login per-account AND per-IP lockout)

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'

export interface LimitResult {
  ok: boolean
  retryAfterSec: number
  remaining: number
}

export interface LockoutOptions {
  /** consecutive failures before locking starts */
  threshold: number
  /** lock duration for the first lock */
  baseMs: number
  /** lock duration cap */
  maxMs: number
  /** failures decay to zero after this long without a failure */
  decayMs: number
}

export const LOGIN_LOCKOUT: LockoutOptions = {
  threshold: 5,
  baseMs: 15_000,
  maxMs: 3_600_000,
  decayMs: 15 * 60_000,
}

export interface LockoutState {
  locked: boolean
  retryAfterSec: number
  failCount: number
}

/** Pure: backoff duration after the Nth consecutive failure (0 = unlocked). */
export function backoffMs(failCount: number, opts: LockoutOptions): number {
  if (failCount < opts.threshold) return 0
  const steps = failCount - opts.threshold // 0,1,2,...
  return Math.min(opts.baseMs * 2 ** steps, opts.maxMs)
}

type Row = { hits: string; failCount: number; lockedUntil: Date | null; updatedAt: Date }
type Client = PrismaClient
const cache = new Map<string, { row: Row; at: number }>()
const CACHE_TTL_MS = 1_000
let lastPurge = 0

function readCache(key: string): Row | null {
  const c = cache.get(key)
  if (!c || Date.now() - c.at > CACHE_TTL_MS) return null
  return c.row
}

function writeCache(key: string, row: Row) {
  cache.set(key, { row, at: Date.now() })
  if (cache.size > 5000) {
    // cheap size cap: drop the oldest half
    const keys = [...cache.keys()].slice(0, Math.floor(cache.size / 2))
    for (const k of keys) cache.delete(k)
  }
}

async function purgeOld(dbx: Client) {
  const now = Date.now()
  if (now - lastPurge < 10 * 60_000) return
  lastPurge = now
  await dbx.rateLimitBucket
    .deleteMany({ where: { updatedAt: { lt: new Date(now - 24 * 3600_000) } } })
    .catch(() => undefined)
}

function parseHits(raw: string): number[] {
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter((t): t is number => Number.isFinite(t)) : []
  } catch {
    return []
  }
}

/** Sliding-window rate limit. Persists across restarts. */
export async function limit(
  key: string,
  max: number,
  windowMs: number,
  dbx: Client = defaultDb,
): Promise<LimitResult> {
  const now = Date.now()
  void purgeOld(dbx)

  const row = await dbx.$transaction(async (tx) => {
    const found = await tx.rateLimitBucket.findUnique({ where: { key } })
    const hits = found ? parseHits(found.hits).filter((t) => now - t < windowMs) : []
    if (hits.length >= max) {
      const rowOut = {
        hits: found!.hits,
        failCount: found!.failCount,
        lockedUntil: found!.lockedUntil,
        updatedAt: found!.updatedAt,
      }
      writeCache(key, rowOut)
      return { limited: true as const, retryAfterSec: Math.ceil((hits[0] + windowMs - now) / 1000) }
    }
    hits.push(now)
    const updated = await tx.rateLimitBucket.upsert({
      where: { key },
      create: { key, hits: JSON.stringify(hits) },
      update: { hits: JSON.stringify(hits) },
    })
    return { limited: false as const, remaining: max - hits.length, updatedAt: updated.updatedAt }
  })

  if (row.limited) return { ok: false, retryAfterSec: Math.max(1, row.retryAfterSec), remaining: 0 }
  return { ok: true, retryAfterSec: 0, remaining: row.remaining }
}

/** Read lockout state without mutating it. */
export async function getLockout(key: string, opts: LockoutOptions, dbx: Client = defaultDb): Promise<LockoutState> {
  const found = readCache(key) ?? (await dbx.rateLimitBucket.findUnique({ where: { key } }))
  if (!found) return { locked: false, retryAfterSec: 0, failCount: 0 }
  const now = Date.now()
  // decay: stale failures don't accumulate forever
  const decayed = now - found.updatedAt.getTime() > opts.decayMs
  const failCount = decayed ? 0 : found.failCount
  const lockedUntil = found.lockedUntil
  if (!decayed && lockedUntil && lockedUntil.getTime() > now) {
    return { locked: true, retryAfterSec: Math.ceil((lockedUntil.getTime() - now) / 1000), failCount }
  }
  return { locked: false, retryAfterSec: 0, failCount }
}

/** Record a failure; locks with exponential backoff past the threshold. */
export async function recordFailure(
  key: string,
  opts: LockoutOptions,
  dbx: Client = defaultDb,
): Promise<LockoutState> {
  const now = new Date()
  const res = await dbx.$transaction(async (tx) => {
    const found = await tx.rateLimitBucket.findUnique({ where: { key } })
    const decayed = found ? now.getTime() - found.updatedAt.getTime() > opts.decayMs : true
    const prevFails = found && !decayed ? found.failCount : 0
    const failCount = prevFails + 1
    const lockMs = backoffMs(failCount, opts)
    const lockedUntil = lockMs > 0 ? new Date(now.getTime() + lockMs) : null
    await tx.rateLimitBucket.upsert({
      where: { key },
      create: { key, failCount, lockedUntil },
      update: { failCount, lockedUntil },
    })
    return { failCount, lockedUntil, retryAfterSec: lockMs > 0 ? Math.ceil(lockMs / 1000) : 0 }
  })
  return { locked: res.lockedUntil !== null, retryAfterSec: res.retryAfterSec, failCount: res.failCount }
}

/** Clear the failure counter after a success. */
export async function clearFailures(key: string, dbx: Client = defaultDb): Promise<void> {
  await dbx.rateLimitBucket
    .updateMany({ where: { key, failCount: { not: 0 } }, data: { failCount: 0, lockedUntil: null } })
    .catch(() => undefined)
  cache.delete(key)
}

export function tooMany(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Slow down.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, retryAfterSec)),
      },
    },
  )
}
