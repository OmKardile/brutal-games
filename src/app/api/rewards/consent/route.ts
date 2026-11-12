import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  adult: z.literal(true), // must explicitly send true
  accept: z.literal(true), // and accept the terms
})

/** 18+ declaration. Required before any points can be earned or paid out. */
export async function POST(req: NextRequest) {
  const { user, error } = await authUser()
  if (error) return error

  const rl = limit(`consent:${user.id}`, 5, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'You must confirm you are 18 or older and accept the rewards terms.' },
      { status: 400 },
    )
  }

  if (user.adultDeclaredAt) {
    return NextResponse.json({ ok: true, alreadyDeclared: true })
  }

  await db.user.update({
    where: { id: user.id },
    data: { adultDeclaredAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
