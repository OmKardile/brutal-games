import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'
import { newToken, sha256 } from '@/lib/auth/session'
import { buildAuthorizeUrl } from '@/lib/auth/google'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!env.google.enabled) {
    return NextResponse.json({ error: 'Google login is not configured.' }, { status: 503 })
  }
  const state = newToken()
  const jar = await cookies()
  jar.set('google_oauth_state', sha256(state), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: 600,
  })
  return NextResponse.redirect(buildAuthorizeUrl(state))
}
