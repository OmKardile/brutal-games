import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'
import { newToken, sha256 } from '@/lib/auth/session'
import { sendVerificationEmail } from '@/lib/auth/email'
import { limit, tooMany } from '@/lib/rate-limit'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  const rl = await limit(`resend:${user.id}`, 3, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  const token = newToken()
  await db.emailToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      type: 'VERIFY_EMAIL',
      expiresAt: new Date(Date.now() + 72 * 3600_000),
    },
  })
  const sent = await sendVerificationEmail(user.email, user.name ?? 'pilot', token)
  return NextResponse.json({ ok: true, sent })
}
