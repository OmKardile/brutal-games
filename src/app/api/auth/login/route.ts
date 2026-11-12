import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/env'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth/session'
import { limit, tooMany } from '@/lib/rate-limit'
import { registerDevice } from '@/lib/rewards/fraud'
import { getSettings } from '@/lib/rewards/config'

export const dynamic = 'force-dynamic'

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  signals: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') ?? ''
  const rl = limit(`login:${ip}`, 10, 60_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login payload.' }, { status: 400 })
  }
  const { email, password, signals } = parsed.data

  const user = await db.user.findUnique({ where: { email } })
  const ok = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false
  if (!user || !ok) {
    return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 })
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  try {
    const settings = await getSettings()
    await registerDevice(user.id, { userAgent: ua, ...signals }, ip, settings)
  } catch (err) {
    console.error('registerDevice failed', err)
  }

  const session = await createSession(user.id, { ip, userAgent: ua })
  const res = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
    },
  })
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))
  return res
}
