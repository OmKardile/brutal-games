import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'
import { sha256, destroyAllUserSessions, SESSION_COOKIE } from '@/lib/auth/session'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

/** GET /api/auth/sessions — list this account's active sessions. */
export async function GET() {
  const { user, error } = await authUser()
  if (error) return error

  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const currentHash = token ? sha256(token) : null

  const now = new Date()
  const rows = await db.session.findMany({
    where: { userId: user.id, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true, tokenHash: true },
  })

  return NextResponse.json({
    sessions: rows.map((r) => ({
      id: r.id,
      current: r.tokenHash === currentHash,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    })),
  })
}

const RevokeSchema = z.object({
  revoke: z.enum(['others', 'all']),
})

/** POST /api/auth/sessions — "log out everywhere" (all) or everywhere-except-here (others). */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  const body = await req.json().catch(() => null)
  const parsed = RevokeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }

  if (parsed.data.revoke === 'all') {
    await destroyAllUserSessions(user.id)
    const res = NextResponse.json({ ok: true, revoked: 'all' })
    res.cookies.delete(SESSION_COOKIE)
    return res
  }

  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'No session cookie.' }, { status: 400 })
  const result = await db.session.deleteMany({
    where: { userId: user.id, tokenHash: { not: sha256(token) } },
  })
  return NextResponse.json({ ok: true, revoked: result.count })
}
