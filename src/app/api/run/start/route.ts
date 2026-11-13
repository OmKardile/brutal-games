import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { clientIp } from '@/lib/env'
import { authUser } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { startPlaySession } from '@/lib/rewards/heartbeat'
import { registerDevice, type DeviceSignals } from '@/lib/rewards/fraud'
import { csrfBlocked } from '@/lib/http'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  game: z.enum(['arena', 'stack', 'reflex', 'dodge', 'merge']).optional(),
  /** seed the run is bound to (daily challenges) — verified at submission */
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  signals: z.record(z.string(), z.unknown()).optional(),
})

/**
 * POST /api/run/start — open a run session (generalized in 0.8; replaces the
 * rewards-only play-session starter for ALL runs).
 *
 * Auth required, but NO 18+/rewards coupling: the session serves leaderboard
 * integrity (ranked score submission needs its token). Points still flow only
 * through the rewards paths, which enforce consent/caps at award time.
 * Returns an HMAC-SIGNED token (userId, game, seed, nonce, server startedAt,
 * key id) plus the first heartbeat challenge; only the token's sha256 is
 * stored. One open session per account — starting a new run aborts the
 * previous one.
 */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  const rl = await limit(`run-start:${user.id}`, 30, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid run payload.' }, { status: 400 })
  }

  const settings = await getSettings()
  const ip = clientIp(req)

  // device fingerprint + fraud signals (flag-only, best-effort)
  try {
    const signals: DeviceSignals = {
      userAgent: req.headers.get('user-agent') ?? '',
      ...(parsed.data.signals ?? {}),
    }
    await registerDevice(user.id, signals, ip, settings)
  } catch (err) {
    console.error('registerDevice failed', err)
  }

  const { token, intervalSec, challenge } = await startPlaySession(
    user.id,
    parsed.data.game ?? null,
    parsed.data.seed ?? null,
    settings,
    ip,
  )
  return NextResponse.json({ token, intervalSec, challenge })
}
