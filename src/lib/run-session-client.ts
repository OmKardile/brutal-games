'use client'

// Run-session client (0.8): the single owner of the CURRENT run token.
//
// One session per run, shared by every consumer:
//  - ranked score submission (scores-client reads the token at submit time)
//  - RewardsHud heartbeats + run-end (subscribes to token changes)
// beginRun() is called by each game page when the run actually starts; it
// no-ops for guests (401) and offline — those runs simply stay unranked /
// fall back to the local board. A new run replaces the previous token (the
// server also aborts the previous session: one active run per account).

import { apiUrl } from '@/lib/api-base'
import type { GameId } from '@/lib/scores-client'

let token: string | null = null
let starting = false
const listeners = new Set<(t: string | null) => void>()

function notify() {
  for (const fn of listeners) {
    try {
      fn(token)
    } catch {
      // listener errors must never break the run flow
    }
  }
}

export function currentRunToken(): string | null {
  return token
}

export function subscribeRunToken(fn: (t: string | null) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function collectSignals() {
  return {
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${window.screen.width}x${window.screen.height} x${window.devicePixelRatio}`,
    platform: (navigator as unknown as { platform?: string }).platform ?? '',
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
  }
}

/** Open a run session. Idempotent while a token is alive or a start is pending. */
export async function beginRun(game: GameId): Promise<string | null> {
  if (token || starting) return token
  starting = true
  try {
    const res = await fetch(apiUrl('/api/run/start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, signals: collectSignals() }),
    })
    if (res.ok) {
      const data = (await res.json()) as { token: string }
      token = data.token
      notify()
      return token
    }
    // 401 guest / 403 frozen / 429 — play on unranked
    return null
  } catch {
    // offline — play on
    return null
  } finally {
    starting = false
  }
}

/** Drop the current token (called when a run definitively ends). */
export function endRun(): void {
  if (token) {
    token = null
    notify()
  }
}
