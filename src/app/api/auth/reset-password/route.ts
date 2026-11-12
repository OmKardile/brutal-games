import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, validatePasswordPolicy } from '@/lib/auth/password'
import { sha256, destroyAllUserSessions } from '@/lib/auth/session'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200),
})

export async function POST(req: NextRequest) {
  const rl = limit('reset', 20, 60_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  const { token, password } = parsed.data

  const policy = validatePasswordPolicy(password)
  if (policy) return NextResponse.json({ error: policy }, { status: 400 })

  const row = await db.emailToken.findUnique({ where: { tokenHash: sha256(token) } })
  if (!row || row.type !== 'RESET_PASSWORD' || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 })
  }

  await db.$transaction([
    db.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(password) },
    }),
  ])
  await destroyAllUserSessions(row.userId) // security: kill all sessions
  return NextResponse.json({ ok: true })
}
