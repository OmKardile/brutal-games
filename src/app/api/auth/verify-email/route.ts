import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256 } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** GET /api/auth/verify-email?token=... — consumed by the link in the email. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/verify-email?status=${reason}`, req.nextUrl.origin))

  if (!token) return fail('invalid')
  const row = await db.emailToken.findUnique({ where: { tokenHash: sha256(token) } })
  if (!row || row.type !== 'VERIFY_EMAIL' || row.usedAt) return fail('invalid')
  if (row.expiresAt.getTime() < Date.now()) return fail('expired')

  await db.$transaction([
    db.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } }),
  ])
  return NextResponse.redirect(new URL('/verify-email?status=ok', req.nextUrl.origin))
}
