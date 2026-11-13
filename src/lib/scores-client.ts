// Shared leaderboard client.
//
// Two deployment modes share this code:
//  - dynamic (self-hosted / sandbox): hits /api/scores backed by SQLite
//  - static export (GitHub Pages): the API does not exist; fetch fails and we
//    fall back to a per-browser localStorage leaderboard so the site is still
//    fully playable with a "local board".
//
// Since 0.8, POST /api/scores requires an account (guests get the local
// board — same as the static export); ranked submissions carry the run
// token owned by run-session-client.
//
// All paths go through apiUrl() so the static build's basePath is respected.

import { apiUrl } from '@/lib/api-base'
import { currentRunToken } from '@/lib/run-session-client'

export { API_BASE, apiUrl } from '@/lib/api-base'

export type GameId = 'arena' | 'stack' | 'reflex' | 'dodge' | 'merge'

export interface BoardEntry {
  id: string
  name: string
  score: number
  wave: number
  kills: number
  game?: GameId
}

export interface BoardTotals {
  runs: number
  kills: number
  top: number
}

export interface BoardResult {
  scores: BoardEntry[]
  totals: BoardTotals | null
  mode: 'online' | 'local'
}

const LS_KEY = (game: GameId) => `brutal.board.${game}`
const LS_NAME_KEY = 'brutal.playerName'

function loadLocal(game: GameId): BoardEntry[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY(game))
    if (!raw) return []
    const parsed = JSON.parse(raw) as BoardEntry[]
    return Array.isArray(parsed) ? parsed.slice(0, 10) : []
  } catch {
    return []
  }
}

function saveLocal(game: GameId, entries: BoardEntry[]): void {
  try {
    window.localStorage.setItem(LS_KEY(game), JSON.stringify(entries.slice(0, 10)))
  } catch {
    // storage unavailable — nothing to persist
  }
}

function pushLocal(game: GameId, entry: BoardEntry): BoardEntry[] {
  const next = [...loadLocal(game), entry]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10)
  saveLocal(game, next)
  return next
}

function localTotals(game: GameId): BoardTotals {
  const entries = loadLocal(game)
  return {
    runs: entries.length,
    kills: entries.reduce((sum, e) => sum + (e.kills || 0), 0),
    top: entries[0]?.score ?? 0,
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 2500): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Load the top-10 board for a game. Online first, localStorage fallback. */
export async function fetchBoard(game: GameId): Promise<BoardResult> {
  try {
    const res = await fetchWithTimeout(apiUrl(`/api/scores?game=${game}`), {
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as { scores?: BoardEntry[]; totals?: BoardTotals }
    return {
      scores: data.scores ?? [],
      totals: data.totals ?? null,
      mode: 'online',
    }
  } catch {
    return { scores: loadLocal(game), totals: localTotals(game), mode: 'local' }
  }
}

export interface SubmitPayload {
  name: string
  score: number
  wave: number
  kills: number
}

export interface SubmitResult {
  ok: boolean
  rank: number | null
  board: BoardEntry[]
  mode: 'online' | 'local'
  /** true when the online board rejected us because we're not signed in —
   *  the caller can show a "sign in to rank" hint */
  authRequired?: boolean
  /** false when the server stored the run display-only (no valid run token) */
  ranked?: boolean
}

/** Submit a run. Online first; on static/offline deploys logs it locally. */
export async function submitScore(
  game: GameId,
  payload: SubmitPayload,
): Promise<SubmitResult> {
  try {
    const res = await fetchWithTimeout(apiUrl('/api/scores'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, game, runToken: currentRunToken() ?? undefined }),
    })
    if (res.status === 401) {
      // not signed in: local board, flagged so pages can show a sign-in hint
      const entry = localEntry(game, payload)
      const board = pushLocal(game, entry)
      const rank = board.findIndex((e) => e.id === entry.id)
      return { ok: true, rank: rank >= 0 ? rank + 1 : null, board, mode: 'local', authRequired: true }
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as {
      rank?: number
      scores?: BoardEntry[]
      ranked?: boolean
    }
    return {
      ok: true,
      rank: data.rank ?? null,
      board: data.scores ?? [],
      mode: 'online',
      ranked: data.ranked ?? false,
    }
  } catch {
    const entry = localEntry(game, payload)
    const board = pushLocal(game, entry)
    const rank = board.findIndex((e) => e.id === entry.id)
    return { ok: true, rank: rank >= 0 ? rank + 1 : null, board, mode: 'local' }
  }
}

function localEntry(game: GameId, payload: SubmitPayload): BoardEntry {
  return {
    id: `local-${Date.now()}`,
    name: payload.name,
    score: payload.score,
    wave: payload.wave,
    kills: payload.kills,
    game,
  }
}

export function rememberPlayerName(name: string): void {
  try {
    window.localStorage.setItem(LS_NAME_KEY, name)
  } catch {
    // ignore
  }
}

export function recallPlayerName(): string {
  try {
    return window.localStorage.getItem(LS_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
