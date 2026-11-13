import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/env'
import { newToken, sha256 } from '@/lib/auth/session'
import { sendPasswordResetEmail } from '@/lib/auth/email'
import { limit, tooMany } from '@/lib/rate-limit'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Schema = z.object({ email: z.string().trim().toLowerCase().email().max(200) })

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const ip = clientIp(req)
  const rl = await limit(`forgot:${ip}`, 5, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid email.' }, { status: 400 })

  const user = await db.user.findUnique({ where: { email: parsed.data.email } })
  // always answer the same way — no account enumeration
  if (user) {
    const token = newToken()
    await db.emailToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        type: 'RESET_PASSWORD',
        expiresAt: new Date(Date.now() + 3600_000), // 1h, single use
      },
    })
    await sendPasswordResetEmail(user.email, token)
  }
  return NextResponse.json({ ok: true })
}
