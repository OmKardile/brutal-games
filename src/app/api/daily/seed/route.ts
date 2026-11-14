import { NextRequest, NextResponse } from 'next/server'
import { getGame } from '@/games/registry'
import { getPortalConfig } from '@/lib/daily/config'
import { dailySeedFor } from '@/lib/daily/seed'
import { mutatorIdFor, gameHasMutators } from '@/lib/daily/mutators'
import { festivalFor } from '@/lib/daily/festival'
import { dateKeyForTz } from '@/lib/daily/tz'
import { limit, tooMany } from '@/lib/rate-limit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * GET /api/daily/seed?game=stack
 * → { game, dateKey, seed, tz, dailyEnabled, mutator, festival }
 * Server-authoritative: everyone gets the same seed for a game on a day.
 * The client may compute a LOCAL fallback seed offline — such runs submit as
 * ranked=false and are marked UNRANKED on the board.
 * The mutator (roadmap slice 1) is derived the same way — same day, same
 * mutator for everyone; null when the game has no mutator set yet.
 * During a festival window (slice 3) the festival meta rides along for the
 * banner/SEO copy; the mutator id is already the festival one.
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
  const festival = festivalFor(dateKey)

  return NextResponse.json(
    {
      game: game.slug,
      dateKey,
      seed,
      tz: cfg.DAILY_TZ,
      dailyEnabled: game.dailyEnabled,
      mutator: gameHasMutators(game.slug) ? mutatorIdFor(game.slug, dateKey) : null,
      festival: festival
        ? {
            id: festival.festival.id,
            name: festival.festival.name,
            tag: festival.festival.tag,
            dayIndex: festival.dayIndex,
            totalDays: festival.totalDays,
          }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
