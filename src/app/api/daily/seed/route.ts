import { NextRequest, NextResponse } from 'next/server'
import { getGame } from '@/games/registry'
import { getPortalConfig } from '@/lib/daily/config'
import { dailySeedFor } from '@/lib/daily/seed'
import { dateKeyForTz } from '@/lib/daily/tz'
import { limit, tooMany } from '@/lib/rate-limit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * GET /api/daily/seed?game=stack
 * → { game, dateKey, seed, tz, dailyEnabled }
 * Server-authoritative: everyone gets the same seed for a game on a day.
 * The client may compute a LOCAL fallback seed offline — such runs submit as
 * ranked=false and are marked UNRANKED on the board.
 */
export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  if (!(await limit(`daily-seed:${ip}`, 60, 60_000)).ok) return tooMany(60)

  const slug = req.nextUrl.searchParams.get('game') ?? ''
  const game = getGame(slug)
  if (!game) {
    return NextResponse.json({ error: 'Unknown game' }, { status: 400 })
  }

  const cfg = await getPortalConfig()
  const dateKey = dateKeyForTz(new Date(), cfg.DAILY_TZ)
  const seed = dailySeedFor(game.slug, dateKey)

  return NextResponse.json(
    {
      game: game.slug,
      dateKey,
      seed,
      tz: cfg.DAILY_TZ,
      dailyEnabled: game.dailyEnabled,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
