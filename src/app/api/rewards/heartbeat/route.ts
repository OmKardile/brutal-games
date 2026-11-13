import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authUser } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { processHeartbeat } from '@/lib/rewards/heartbeat'
import { csrfBlocked } from '@/lib/http'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  token: z.string().min(20).max(1024),
  visible: z.boolean(),
  inputEvents: z.number().int().min(0).max(1_000_000),
  /** rAF frames rendered since run start (drift signal; optional but checked when present) */
  frames: z.number().int().min(0).max(100_000_000).optional(),
  /** sha256 of the challenge from the previous response (hash chain) */
  challengeResponse: z.string().regex(/^[0-9a-f]{64}$/),
})

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  // burst guard on top of the interval check
  const rl = await limit(`heartbeat:${user.id}`, 10, 60_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid heartbeat.' }, { status: 400 })

  const settings = await getSettings()
  if (!settings.REWARDS_ENABLED) {
    return NextResponse.json({ error: 'Rewards are currently disabled.' }, { status: 403 })
  }

  const result = await processHeartbeat(user.id, settings, user, parsed.data)
  if (!result.ok) {
    const status =
      result.code === 'TOO_FAST' ? 429
        : result.code === 'SESSION_NOT_FOUND' ? 404
          : result.code === 'BAD_CHALLENGE' ? 409
            : 409
    return NextResponse.json({ error: result.code }, { status })
  }
  return NextResponse.json(result)
}
