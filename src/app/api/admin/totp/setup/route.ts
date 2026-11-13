import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminForTotp } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { generateTotpSecret, encryptSecret, totpUri } from '@/lib/auth/totp'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/totp/setup — generate (or regenerate) a TOTP secret.
 * Reachable by an ADMIN without an admin token: this is the forced-enrollment
 * path. The secret is returned ONCE and stored encrypted; enrollment finishes
 * with /api/admin/totp/enable { code }.
 */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user, error } = await requireAdminForTotp()
  if (error) return error

  const secret = generateTotpSecret()
  await db.user.update({
    where: { id: user.id },
    data: { totpSecret: encryptSecret(secret) },
  })
  await logAdminAction({
    adminId: user.id,
    action: 'TOTP_SETUP',
    targetType: 'totp',
    targetId: user.id,
    after: { enrolled: true },
    ip: clientIp(req),
  })
  // shown exactly once — the stored value is AES-256-GCM encrypted
  return NextResponse.json({ secret, uri: totpUri(secret, user.email) })
}
