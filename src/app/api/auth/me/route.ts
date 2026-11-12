import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { getSettings } from '@/lib/rewards/config'
import { env } from '@/lib/env'
import { dailyChallengeFor } from '@/lib/rewards/challenge'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  const settings = await getSettings()
  const challenge = dailyChallengeFor()
  return NextResponse.json({
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          emailVerified: Boolean(user.emailVerified),
          adultDeclared: Boolean(user.adultDeclaredAt),
          upiId: user.upiId,
        }
      : null,
    rewardsEnabled: settings.REWARDS_ENABLED,
    googleEnabled: env.google.enabled,
    turnstileSiteKey: env.turnstile.siteKey,
    dailyChallenge: settings.REWARDS_ENABLED ? challenge : null,
  })
}
