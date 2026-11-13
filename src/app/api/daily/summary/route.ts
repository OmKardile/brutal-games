import { NextRequest, NextResponse } from 'next/server'
import { getGame } from '@/games/registry'
import { getPortalConfig } from '@/lib/daily/config'
import { dailyBest, getStreak } from '@/lib/daily/board'
import { dateKeyForTz } from '@/lib/daily/tz'
import { limit, tooMany } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/daily/summary?game=stack
 * → { game, dateKey, playedToday, myBest, streak, signedIn }
 * Guests get myBest=null and streak=null (their streak lives in localStorage).
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!limit(`daily-summary:${ip}`, 60, 60_000).ok) return tooMany(60)

  const slug = req.nextUrl.searchParams.get('game') ?? ''
  const game = getGame(slug)
  if (!game) return NextResponse.json({ error: 'Unknown game' }, { status: 400 })

  const cfg = await getPortalConfig()
  const dateKey = dateKeyForTz(new Date(), cfg.DAILY_TZ)
  const user = await getSessionUser()

  try {
    let myBest: number | null = null
    let streak: { current: number; longest: number; lastDateKey: string } | null = null
    if (user) {
      ;[myBest, streak] = await Promise.all([
        dailyBest(db, { game: game.slug, dateKey, userId: user.id }),
        getStreak(db, user.id),
      ])
    }
    return NextResponse.json(
      {
        game: game.slug,
        dateKey,
        dailyEnabled: game.dailyEnabled,
        signedIn: Boolean(user),
        myBest,
        streak,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('GET /api/daily/summary failed', err)
    return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 })
  }
}
