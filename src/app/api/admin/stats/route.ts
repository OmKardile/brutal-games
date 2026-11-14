import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/guard'
import { getPortalConfig } from '@/lib/daily/config'
import { retentionReport } from '@/lib/daily/stats'
import { dateKeyForTz } from '@/lib/daily/tz'
import { limit, tooMany } from '@/lib/rate-limit'
import { clientIp } from '@/lib/env'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  days: z.coerce.number().int().min(2).max(90).default(30).catch(30),
})

/**
 * GET /api/admin/stats?days=30 — the retention read-out (roadmap slice 0,
 * ADR-029): DAU per day, D1 cohorts (share of a day's players seen later in
 * the window), run totals and ranked share. Computed from EXISTING tables
 * (DailyActivity ∪ DailyRun) — no new tracking. Role-guarded like every
 * admin surface (admin session + 2FA per requireAdmin).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const ip = clientIp(req)
  if (!(await limit(`admin-stats:${ip}`, 10, 60_000)).ok) return tooMany(60)

  const parsed = QuerySchema.safeParse({
    days: req.nextUrl.searchParams.get('days') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'days must be 2-90' }, { status: 400 })
  }

  const cfg = await getPortalConfig()
  const todayKey = dateKeyForTz(new Date(), cfg.DAILY_TZ)
  try {
    const report = await retentionReport(db, {
      tz: cfg.DAILY_TZ,
      todayKey,
      days: parsed.data.days,
    })
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('GET /api/admin/stats failed', err)
    return NextResponse.json({ error: 'Failed to compute stats' }, { status: 500 })
  }
}
