import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { env, clientIp } from '@/lib/env'
import { sha256, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth/session'
import { exchangeCode, loginWithGoogle } from '@/lib/auth/google'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!env.google.enabled) {
    return NextResponse.redirect(new URL('/login?error=google_not_configured', req.nextUrl.origin))
  }
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state') ?? ''
  const jar = await cookies()
  const expected = jar.get('google_oauth_state')?.value
  jar.delete('google_oauth_state')

  if (!code || !state || !expected || sha256(state) !== expected) {
    return NextResponse.redirect(new URL('/login?error=google_state', req.nextUrl.origin))
  }

  try {
    const profile = await exchangeCode(code)
    const session = await loginWithGoogle(profile, {
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent') ?? undefined,
    })
    const res = NextResponse.redirect(new URL('/', req.nextUrl.origin))
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))
    return res
  } catch (err) {
    console.error('google callback failed', err)
    return NextResponse.redirect(new URL('/login?error=google_failed', req.nextUrl.origin))
  }
}
