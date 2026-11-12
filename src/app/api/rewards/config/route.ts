import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/rewards/config'
import { dailyChallengeFor } from '@/lib/rewards/challenge'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Public, unauthenticated: tells the UI whether reward surfaces exist. */
export async function GET() {
  const settings = await getSettings()
  const challenge = dailyChallengeFor()
  return NextResponse.json({
    enabled: settings.REWARDS_ENABLED,
    challenge: settings.REWARDS_ENABLED ? { desc: challenge.desc, kind: challenge.kind, target: challenge.target } : null,
    minPayoutMinor: settings.MIN_PAYOUT_MINOR,
    googleEnabled: env.google.enabled,
    turnstileSiteKey: env.turnstile.siteKey,
  })
}
