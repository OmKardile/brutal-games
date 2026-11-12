// Lightweight own-cookie sessions (no next-auth — see decisions.md ADR-003).
// The cookie carries a random token; only its sha256 hash is stored.

import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import type { User } from '@prisma/client'

export const SESSION_COOKIE = 'brutal_session'
const SESSION_TTL_MS = 30 * 24 * 3600_000 // 30 days
const RENEW_WINDOW_MS = 15 * 24 * 3600_000 // extend when < 15 days left

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 400),
    },
  })
  return { token, expiresAt }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    expires: expiresAt,
  }
}

/** Reads the session cookie, returns the user or null. Sliding renewal. */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const row = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  })
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: row.id } }).catch(() => undefined)
    return null
  }
  if (row.expiresAt.getTime() - Date.now() < RENEW_WINDOW_MS) {
    await db.session
      .update({
        where: { id: row.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => undefined)
  }
  return row.user
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } }).catch(() => undefined)
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } }).catch(() => undefined)
}

/** Guard for route handlers: user must exist and not be frozen. */
export function userCanPlay(user: User): boolean {
  return user.status === 'ACTIVE'
}
