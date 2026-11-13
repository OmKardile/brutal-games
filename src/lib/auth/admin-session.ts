// Stateless short-lived ADMIN session token (phase 5).
//
// Issued ONLY at login when an ADMIN presents password + valid TOTP (or, for
// enrollment, password alone while no secret exists — enrollment routes are
// the only thing that token can reach). HMAC-signed, 1-hour hard expiry, no
// server state. `requireAdmin(req)` demands it on top of the regular session:
// a stolen session cookie alone can never reach admin routes.
//
// Authz stays inside route handlers (ADR: never middleware alone).

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

export const ADMIN_COOKIE = 'brutal_admin'
export const ADMIN_TOKEN_TTL_MS = 60 * 60_000 // hard 1h — re-auth after

interface AdminTokenPayload {
  uid: string
  exp: number // ms epoch
}

function sign(body: string): string {
  const key = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'utf8')).update('admin-session-v1').digest()
  return createHmac('sha256', key).update(body).digest('base64url')
}

export function issueAdminToken(uid: string, now: number = Date.now()): { token: string; expiresAt: Date } {
  const payload: AdminTokenPayload = { uid, exp: now + ADMIN_TOKEN_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(payload.exp) }
}

export function verifyAdminToken(token: string | undefined | null, uid: string, now: number = Date.now()): boolean {
  if (!token || token.length > 512) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false
  const body = token.slice(0, dot)
  const sig = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(body), 'base64url')
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminTokenPayload
    return payload.uid === uid && payload.exp > now
  } catch {
    return false
  }
}

export function adminCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const, // stricter than the session cookie (H5 groundwork)
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    expires: expiresAt,
  }
}

/** Read + verify the admin cookie for the given user. */
export async function hasValidAdminToken(uid: string): Promise<boolean> {
  const jar = await cookies()
  return verifyAdminToken(jar.get(ADMIN_COOKIE)?.value, uid)
}
