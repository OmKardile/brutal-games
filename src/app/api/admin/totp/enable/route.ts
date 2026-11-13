import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdminForTotp } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { decryptSecret, verifyTotp } from '@/lib/auth/totp'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

const Schema = z.object({ code: z.string().regex(/^\d{6}$/) })

/**
 * POST /api/admin/totp/enable — verify the first code and activate 2FA.
 * Until this succeeds, requireAdmin keeps returning TOTP_SETUP_REQUIRED.
 */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await requireAdminForTotp()
  if (error) return error

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
  }

  const secret = user.totpSecret ? decryptSecret(user.totpSecret) : null
  if (!secret) {
    return NextResponse.json({ error: 'Run setup first.' }, { status: 400 })
  }
  if (!verifyTotp(secret, parsed.data.code)) {
    return NextResponse.json({ error: 'Wrong code — try the current one.' }, { status: 400 })
  }
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } })
  await logAdminAction({
    adminId: user.id,
    action: 'TOTP_ENABLED',
    targetType: 'totp',
    targetId: user.id,
    ip: clientIp(req),
  })
  return NextResponse.json({ ok: true })
}
