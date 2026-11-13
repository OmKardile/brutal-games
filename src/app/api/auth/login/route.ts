import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sha256 } from '@/lib/auth/session'
import { clientIp } from '@/lib/env'
import {
  verifyPassword,
  hashPassword,
  needsRehash,
  dummyVerify,
} from '@/lib/auth/password'
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth/session'
import { decryptSecret, verifyTotp } from '@/lib/auth/totp'
import { issueAdminToken, adminCookieOptions, ADMIN_COOKIE } from '@/lib/auth/admin-session'
import {
  limit,
  tooMany,
  getLockout,
  recordFailure,
  clearFailures,
  LOGIN_LOCKOUT,
} from '@/lib/rate-limit'
import { registerDevice } from '@/lib/rewards/fraud'
import { getSettings } from '@/lib/rewards/config'
import { verifyTurnstile, turnstileEnabled } from '@/lib/captcha'
import { csrfBlocked } from '@/lib/http'
import { securityLog } from '@/lib/security-log'
import { alert } from '@/lib/alerts'

export const dynamic = 'force-dynamic'

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  /** 6-digit TOTP code — required for ADMIN accounts with 2FA enabled */
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  turnstileToken: z.string().optional(),
  signals: z.record(z.string(), z.unknown()).optional(),
})

/** consecutive account failures after which Turnstile is demanded */
const CAPTCHA_AFTER_FAILS = 3

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') ?? ''
  const rl = await limit(`login:${ip}`, 10, 60_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login payload.' }, { status: 400 })
  }
  const { email, password, totpCode, turnstileToken, signals } = parsed.data

  // per-account AND per-IP lockout with exponential backoff (M5 fix)
  const acctKey = `loginfail:acct:${email}`
  const ipKey = `loginfail:ip:${ip}`
  const [acctLock, ipLock] = await Promise.all([
    getLockout(acctKey, LOGIN_LOCKOUT),
    getLockout(ipKey, LOGIN_LOCKOUT),
  ])
  const captchaRequired =
    turnstileEnabled() && Math.max(acctLock.failCount, ipLock.failCount) >= CAPTCHA_AFTER_FAILS
  const lock = acctLock.locked ? acctLock : ipLock
  if (lock.locked) {
    securityLog('auth.login_locked', { emailHash: sha256(email).slice(0, 12) })
    return NextResponse.json(
      {
        error: 'Too many failed attempts. Try again later.',
        captchaRequired,
        retryAfterSec: lock.retryAfterSec,
      },
      { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } },
    )
  }

  if (captchaRequired) {
    const ok = await verifyTurnstile(turnstileToken, req)
    if (!ok) {
      return NextResponse.json({ error: 'Captcha failed.', captchaRequired: true }, { status: 400 })
    }
  }

  const user = await db.user.findUnique({ where: { email } })
  let ok = false
  if (user?.passwordHash) {
    ok = await verifyPassword(password, user.passwordHash)
  } else {
    // constant-ish timing: burn the same KDF cost when the user is unknown
    await dummyVerify()
  }
  if (!user || !ok) {
    securityLog('auth.login_failed', { emailHash: sha256(email).slice(0, 12) })
    await Promise.all([recordFailure(acctKey, LOGIN_LOCKOUT), recordFailure(ipKey, LOGIN_LOCKOUT)])
    const fails = Math.max(acctLock.failCount + 1, ipLock.failCount + 1)
    return NextResponse.json(
      {
        error: 'Wrong email or password.',
        captchaRequired: turnstileEnabled() && fails >= CAPTCHA_AFTER_FAILS,
      },
      { status: 401 },
    )
  }

  // transparent hash upgrade (scrypt -> argon2id) on the Bun runtime
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    try {
      const upgraded = await hashPassword(password)
      await db.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } })
    } catch (err) {
      console.error('password rehash failed', err)
    }
  }

  await Promise.all([clearFailures(acctKey), clearFailures(ipKey)])
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  securityLog('auth.login_success', { userId: user.id, role: user.role })
  // admin login from a new network -> alert (threat T9)
  if (user.role === 'ADMIN') {
    const known = await db.session.findFirst({
      where: { userId: user.id, ip, createdAt: { lt: new Date(Date.now() - 60_000) } },
      select: { id: true },
    })
    const firstEver = (await db.session.count({ where: { userId: user.id } })) <= 1
    if (!known && !firstEver) {
      void alert('Admin login from a new IP', { adminId: user.id }, 'critical')
    }
  }

  // ADMIN accounts: password alone is never enough once 2FA is live.
  // Without an enabled secret we still log in — but requireAdmin forces
  // enrollment before any admin action (the admin token below only unlocks
  // the TOTP setup/enable routes until then).
  let adminToken: { token: string; expiresAt: Date } | null = null
  if (user.role === 'ADMIN') {
    if (user.totpSecret && user.totpEnabledAt) {
      const secret = decryptSecret(user.totpSecret)
      if (!secret || !verifyTotp(secret, totpCode ?? '')) {
        return NextResponse.json(
          { error: 'Wrong or missing 2FA code.', totpRequired: true },
          { status: 401 },
        )
      }
    }
    adminToken = issueAdminToken(user.id)
  }

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
  if (adminToken) {
    res.cookies.set(ADMIN_COOKIE, adminToken.token, adminCookieOptions(adminToken.expiresAt))
  }
  return res
}
