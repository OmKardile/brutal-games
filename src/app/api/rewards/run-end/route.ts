import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authUser } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { awardRunCompletion } from '@/lib/rewards/runs'
import { csrfBlocked } from '@/lib/http'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  token: z.string().min(20).max(200),
  score: z.number().int().min(0).max(100_000_000),
  wave: z.number().int().min(0).max(10_000),
  kills: z.number().int().min(0).max(1_000_000),
  timeAlive: z.number().min(0).max(86_400),
})

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  const rl = await limit(`run-end:${user.id}`, 30, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid run payload.' }, { status: 400 })
  const { token, ...stats } = parsed.data

  const settings = await getSettings()
  if (!settings.REWARDS_ENABLED) {
    return NextResponse.json({ error: 'Rewards are currently disabled.' }, { status: 403 })
  }

  const result = await awardRunCompletion(settings, user, token, stats)
  if (!result.ok) {
    const status = result.code === 'SESSION_NOT_FOUND' ? 404 : 409
    return NextResponse.json({ error: result.code ?? 'blocked' }, { status })
  }
  return NextResponse.json(result)
}
