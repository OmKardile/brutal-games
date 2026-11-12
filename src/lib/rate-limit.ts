// In-memory sliding-window rate limiter. Single-process only (the standalone
// bun deploy is single-instance — see technical-documentation.md). Resets on
// restart; every rewards endpoint is additionally protected by server-side
// business rules (caps, intervals), so a restart is not an attack window.

interface Bucket {
  hits: number[]
}

const buckets = new Map<string, Bucket>()
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) {
    if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] > 3_600_000) buckets.delete(k)
  }
}

export interface LimitResult {
  ok: boolean
  retryAfterSec: number
  remaining: number
}

export function limit(key: string, max: number, windowMs: number): LimitResult {
  const now = Date.now()
  sweep(now)
  const b = buckets.get(key) ?? { hits: [] }
  b.hits = b.hits.filter((t) => now - t < windowMs)
  if (b.hits.length >= max) {
    const retryAfterSec = Math.ceil((b.hits[0] + windowMs - now) / 1000)
    buckets.set(key, b)
    return { ok: false, retryAfterSec, remaining: 0 }
  }
  b.hits.push(now)
  buckets.set(key, b)
  return { ok: true, retryAfterSec: 0, remaining: max - b.hits.length }
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
