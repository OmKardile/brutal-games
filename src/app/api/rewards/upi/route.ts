import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { limit, tooMany } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// UPA vpa@handle format: 4-255 chars, handle charset per NPCI
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/

const Schema = z.object({ upiId: z.string().trim().min(4).max(320) })

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  const rl = await limit(`upi:${user.id}`, 10, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })

  const upiId = parsed.data.upiId
  if (!UPI_RE.test(upiId)) {
    return NextResponse.json({ error: 'UPI ID must look like name@bank.' }, { status: 400 })
  }

  await db.user.update({
    where: { id: user.id },
    data: { upiId, upiUpdatedAt: new Date() },
  })
  return NextResponse.json({ ok: true, upiId })
}
