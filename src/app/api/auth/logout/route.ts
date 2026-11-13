import { NextRequest, NextResponse } from 'next/server'
import { destroyCurrentSession, SESSION_COOKIE } from '@/lib/auth/session'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  await destroyCurrentSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
