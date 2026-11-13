import { NextRequest, NextResponse } from 'next/server'
import { getGame } from '@/games/registry'
import { getPortalConfig } from '@/lib/daily/config'
import { dailyBoard } from '@/lib/daily/board'
import { dateKeyForTz, isValidDateKey } from '@/lib/daily/tz'
import { limit, tooMany } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/daily/board?game=stack&dateKey=2026-11-13
 * → best-per-player board for that game+day (today's dateKey by default).
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!limit(`daily-board:${ip}`, 60, 60_000).ok) return tooMany(60)

  const slug = req.nextUrl.searchParams.get('game') ?? ''
  const game = getGame(slug)
  if (!game) return NextResponse.json({ error: 'Unknown game' }, { status: 400 })

  const cfg = await getPortalConfig()
  const todayKey = dateKeyForTz(new Date(), cfg.DAILY_TZ)
  const dateKey = req.nextUrl.searchParams.get('dateKey') ?? todayKey
  if (!isValidDateKey(dateKey)) {
    return NextResponse.json({ error: 'Bad dateKey' }, { status: 400 })
  }

  const user = await getSessionUser()
  try {
    const scores = await dailyBoard(db, {
      game: game.slug,
      dateKey,
      viewerId: user?.id ?? null,
    })
    return NextResponse.json(
      { game: game.slug, dateKey, tz: cfg.DAILY_TZ, scores },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('GET /api/daily/board failed', err)
    return NextResponse.json({ error: 'Failed to load board' }, { status: 500 })
  }
}
