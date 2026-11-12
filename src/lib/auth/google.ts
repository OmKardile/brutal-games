// Google OAuth 2.0 (authorization-code) — a config slot: inactive until
// GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set. Standard flow, no SDK.

import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { createSession } from '@/lib/auth/session'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export function redirectUri(): string {
  return `${env.APP_URL}/api/auth/google/callback`
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface GoogleProfile {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
}

export async function exchangeCode(code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) throw new Error('Google token exchange failed')
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const infoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!infoRes.ok) throw new Error('Google userinfo failed')
  return (await infoRes.json()) as GoogleProfile
}

/** Find-or-create the user for a verified Google profile, then open a session. */
export async function loginWithGoogle(profile: GoogleProfile, meta: { ip?: string; userAgent?: string }) {
  const email = profile.email?.toLowerCase()
  if (!email || !profile.email_verified) {
    throw new Error('Google account has no verified email')
  }
  let user = await db.user.findUnique({ where: { email } })
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        name: profile.name?.slice(0, 64),
        emailVerified: new Date(), // Google asserts verification
      },
    })
  } else if (!user.emailVerified) {
    user = await db.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    })
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return createSession(user.id, meta)
}
