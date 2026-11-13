import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, validatePasswordPolicy, isBreachedPassword } from '@/lib/auth/password'
import { sha256, destroyAllUserSessions } from '@/lib/auth/session'
import { clientIp } from '@/lib/env'
import { limit, tooMany } from '@/lib/rate-limit'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(200),
})

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  // per-IP bucket (was a single global bucket — DoS-able by one attacker)
  const ip = clientIp(req)
  const rl = await limit(`reset:${ip}`, 20, 60_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  const { token, password } = parsed.data

  const policy = validatePasswordPolicy(password)
  if (policy) return NextResponse.json({ error: policy }, { status: 400 })

  const breached = await isBreachedPassword(password)
  if (breached === true) {
    return NextResponse.json(
      { error: 'This password appears in a public breach list. Choose a different one.' },
      { status: 400 },
    )
  }

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
