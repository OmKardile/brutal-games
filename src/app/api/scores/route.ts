import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// games with a shared global leaderboard
const GAMES = ['arena', 'stack', 'reflex', 'dodge', 'merge'] as const
type Game = (typeof GAMES)[number]

const ScoreSchema = z.object({
  name: z.string().trim().min(1).max(16),
  score: z.number().int().min(0).max(100_000_000),
  wave: z.number().int().min(0).max(10_000),
  kills: z.number().int().min(0).max(1_000_000),
  game: z.enum(GAMES).optional().default('arena'),
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
    const [scores, agg] = await Promise.all([
      db.highScore.findMany({
        where: { game },
        orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
        take: 10,
      }),
      db.highScore.aggregate({
        where: { game },
        _count: true,
        _sum: { kills: true, score: true },
        _max: { score: true },
      }),
    ])
    return NextResponse.json({
      scores,
      totals: {
        runs: agg._count,
        kills: agg._sum.kills ?? 0,
        top: agg._max.score ?? 0,
      },
    })
  } catch (err) {
    console.error('GET /api/scores failed', err)
    return NextResponse.json({ error: 'Failed to load scores' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = ScoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid score payload' }, { status: 400 })
    }
    const { name, score, wave, kills, game } = parsed.data
    const created = await db.highScore.create({
      data: { name, score, wave, kills, game },
    })
    const better = await db.highScore.count({
      where: { game, score: { gt: score } },
    })
    const scores = await db.highScore.findMany({
      where: { game },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: 10,
    })
    return NextResponse.json({ created, rank: better + 1, scores })
  } catch (err) {
    console.error('POST /api/scores failed', err)
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }
}
