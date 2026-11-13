import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authUser } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { limit, tooMany } from '@/lib/rate-limit'
import { recordScore, boardTotals, rankedBoard, GAMES, type Game } from '@/lib/scores/service'

export const dynamic = 'force-dynamic'

const ScoreSchema = z.object({
  name: z.string().trim().min(1).max(16), // guest/local-board name; ranked boards use the account callsign
  score: z.number().int().min(0).max(100_000_000),
  wave: z.number().int().min(0).max(10_000),
  kills: z.number().int().min(0).max(1_000_000),
  game: z.enum(GAMES).optional().default('arena'),
  runToken: z.string().min(20).max(200).optional(),
})

function gameFromRequest(req: NextRequest): Game | null {
  const raw = req.nextUrl.searchParams.get('game') ?? 'arena'
  return (GAMES as readonly string[]).includes(raw) ? (raw as Game) : null
}

export async function GET(req: NextRequest) {
  const game = gameFromRequest(req)
  if (!game) {
    return NextResponse.json({ error: 'Unknown game' }, { status: 400 })
  }
  try {
    const [scores, totals] = await Promise.all([rankedBoard(game), boardTotals(game)])
    return NextResponse.json({ scores, totals })
  } catch (err) {
    console.error('GET /api/scores failed', err)
    return NextResponse.json({ error: 'Failed to load scores' }, { status: 500 })
  }
}

/**
 * POST /api/scores — record a completed run (0.8 lock-down, C3 fix).
 *
 *  - login required: guests get 401 and the shared client falls back to the
 *    per-browser local board (same as the static export)
 *  - RANKED requires a run-session token from POST /api/run/start; without
 *    one (or with an invalid/consumed one) the entry is stored display-only
 *    (ranked=false) and stays off the competitive board
 *  - CSRF baseline (Origin + JSON content-type) applies
 */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) {
    return NextResponse.json(
      { error: 'Sign in to post scores to the global board.' },
      { status: 401 },
    )
  }

  const rl = await limit(`score-submit:${user.id}`, 30, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  try {
    const body = await req.json()
    const parsed = ScoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid score payload' }, { status: 400 })
    }
    const { score, wave, kills, game, runToken } = parsed.data

    const result = await recordScore({
      userId: user.id,
      game,
      score,
      wave,
      kills,
      runToken,
    })
    if (result.kind === 'IMPLAUSIBLE') {
      return NextResponse.json({ error: `Run rejected: ${result.reason}` }, { status: 422 })
    }
    if (result.kind === 'NAME_ERROR') {
      return NextResponse.json({ error: result.reason }, { status: 400 })
    }
    return NextResponse.json({
      created: result.entry,
      ranked: result.ranked,
      rank: result.rank || null,
      scores: result.board,
    })
  } catch (err) {
    console.error('POST /api/scores failed', err)
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }
}
