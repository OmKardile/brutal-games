import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { createPayoutRequest, rewardBalance } from '@/lib/rewards/payouts'
import { verifyTurnstile } from '@/lib/captcha'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RequestSchema = z.object({
  amountMinor: z.number().int().min(1).max(100_000_000),
  turnstileToken: z.string().optional(),
})

/** Own payout history. */
export async function GET() {
  const { user, error } = await authUser()
  if (error) return error
  const [requests, balance] = await Promise.all([
    db.payoutRequest.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    }),
    rewardBalance(user.id),
  ])
  return NextResponse.json({ requests, balance })
}

/** Request a payout. Captcha + verified email + 18+ + UPI + hold period. */
export async function POST(req: NextRequest) {
  const { user, error } = await authUser()
  if (error) return error

  const rl = limit(`payout:${user.id}`, 3, 86_400_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payout request.' }, { status: 400 })

  if (!(await verifyTurnstile(parsed.data.turnstileToken, req))) {
    return NextResponse.json({ error: 'Captcha failed.' }, { status: 400 })
  }

  const settings = await getSettings()
  if (!settings.REWARDS_ENABLED) {
    return NextResponse.json({ error: 'Rewards are currently disabled.' }, { status: 403 })
  }

  const result = await createPayoutRequest({
    user,
    settings,
    amountMinor: parsed.data.amountMinor,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: 400 })
  }
  return NextResponse.json(result.request)
}
