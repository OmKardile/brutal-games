import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authUser } from '@/lib/auth/guard'
import { claimDisplayName } from '@/lib/names'
import { limit, tooMany } from '@/lib/rate-limit'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  name: z.string().trim().min(1).max(40),
})

/**
 * POST /api/auth/profile — set/change the account callsign (board display
 * name). Policy + case-insensitive uniqueness enforced by claimDisplayName.
 */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await authUser()
  if (error) return error

  const rl = await limit(`profile:${user.id}`, 10, 3600_000)
  if (!rl.ok) return tooMany(rl.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }

  const result = await claimDisplayName(user.id, parsed.data.name)
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'Could not set callsign.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, name: result.name })
}
