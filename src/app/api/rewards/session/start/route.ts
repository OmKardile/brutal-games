import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { clientIp } from '@/lib/env'
import { authUser } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { startPlaySession } from '@/lib/rewards/heartbeat'
import { registerDevice, type DeviceSignals } from '@/lib/rewards/fraud'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  signals: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const { user, error } = await authUser()
  if (error) return error

  const rl = limit(`session-start:${user.id}`, 30, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  if (!user.adultDeclaredAt) {
    return NextResponse.json({ error: '18+ declaration required to earn points.' }, { status: 403 })
  }

  const settings = await getSettings()
  if (!settings.REWARDS_ENABLED) {
    return NextResponse.json({ error: 'Rewards are currently disabled.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  const signals: DeviceSignals = {
    userAgent: req.headers.get('user-agent') ?? '',
    ...(parsed.success ? parsed.data.signals : {}),
  }

  const ip = clientIp(req)
  try {
    await registerDevice(user.id, signals, ip, settings)
  } catch (err) {
    console.error('registerDevice failed', err)
  }

  const { token, intervalSec } = await startPlaySession(user.id, settings, ip)
  return NextResponse.json({ token, intervalSec })
}
