import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/env'
import {
  hashPassword,
  validatePasswordPolicy,
  isBreachedPassword,
} from '@/lib/auth/password'
import { createSession, sessionCookieOptions, SESSION_COOKIE, newToken, sha256 } from '@/lib/auth/session'
import { sendVerificationEmail } from '@/lib/auth/email'
import { verifyTurnstile } from '@/lib/captcha'
import { limit, tooMany } from '@/lib/rate-limit'
import { registerDevice } from '@/lib/rewards/fraud'
import { getSettings } from '@/lib/rewards/config'
import { sanitizeNameInput, namePolicyError, nameKeyOf } from '@/lib/names'
import { csrfBlocked } from '@/lib/http'
import { securityLog } from '@/lib/security-log'

export const dynamic = 'force-dynamic'

const SignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(40).optional(),
  turnstileToken: z.string().optional(),
  signals: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const ip = clientIp(req)
  const rl = await limit(`signup:${ip}`, 5, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = SignupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid signup payload.' }, { status: 400 })
  }
  const { email, password, turnstileToken, signals } = parsed.data

  // password policy: length only (10+), no composition rules
  const policy = validatePasswordPolicy(password)
  if (policy) return NextResponse.json({ error: policy }, { status: 400 })

  // optional breached-password check (k-anonymity HIBP; fails open)
  const breached = await isBreachedPassword(password)
  if (breached === true) {
    return NextResponse.json(
      { error: 'This password appears in a public breach list. Choose a different one.' },
      { status: 400 },
    )
  }

  if (!(await verifyTurnstile(turnstileToken, req))) {
    return NextResponse.json({ error: 'Captcha failed.' }, { status: 400 })
  }

  // callsign policy + case-insensitive uniqueness (M2 fix)
  let name: string | undefined
  let nameKey: string | undefined
  if (parsed.data.name) {
    const clean = sanitizeNameInput(parsed.data.name)
    const err = namePolicyError(clean)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    const key = nameKeyOf(clean)
    const taken = await db.user.findFirst({ where: { nameKey: key }, select: { id: true } })
    if (taken) return NextResponse.json({ error: 'That callsign is already taken.' }, { status: 409 })
    name = clean
    nameKey = key
  }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    // generic message — don't confirm which emails exist
    return NextResponse.json({ error: 'Cannot sign up with this email.' }, { status: 409 })
  }

  const user = await db.user.create({
    data: { email, name, nameKey, passwordHash: await hashPassword(password) },
  })
  securityLog('auth.signup', { userId: user.id })

  // device fingerprint + fraud signals (flag-only, never blocks signup)
  try {
    const settings = await getSettings()
    await registerDevice(
      user.id,
      { userAgent: req.headers.get('user-agent') ?? '', ...signals },
      ip,
      settings,
    )
  } catch (err) {
    console.error('registerDevice failed', err)
  }

  // email verification token (72h)
  const token = newToken()
  await db.emailToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      type: 'VERIFY_EMAIL',
      expiresAt: new Date(Date.now() + 72 * 3600_000),
    },
  })
  const sent = await sendVerificationEmail(email, name ?? 'pilot', token)

  const session = await createSession(user.id, {
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, emailVerified: false },
    verificationEmailSent: sent,
  })
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))
  return res
}
