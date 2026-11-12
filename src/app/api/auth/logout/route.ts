import { NextResponse } from 'next/server'
import { destroyCurrentSession, SESSION_COOKIE } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  await destroyCurrentSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
