import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { payoutInclude, approvePayout, rejectPayout, markPayoutPaid } from '@/lib/rewards/payouts'
import { getSettings } from '@/lib/rewards/config'
import { logAdminAction } from '@/lib/audit'
import { csrfBlocked } from '@/lib/http'
import { clientIp } from '@/lib/env'
import { securityLog } from '@/lib/security-log'

export const dynamic = 'force-dynamic'

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), id: z.string() }),
  z.object({ action: z.literal('reject'), id: z.string(), reason: z.string().trim().min(3).max(500) }),
  z.object({
    action: z.literal('paid'),
    id: z.string(),
    transactionRef: z.string().trim().min(3).max(200),
  }),
])

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status')
  const where = status && ['PENDING', 'APPROVED', 'REJECTED', 'PAID'].includes(status)
    ? { status }
    : {}
  const requests = await db.payoutRequest.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
    take: 200,
    include: payoutInclude,
  })
  return NextResponse.json({ requests })
}

/**
 * POST /api/admin/payouts — approve / reject / mark paid. All integrity rules
 * live in src/lib/rewards/payouts.ts (transactional, self-approval blocked,
 * two-person rule, kill switch); this route adds the audit trail.
 */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user: admin, error } = await requireAdmin(req)
  if (error) return error
  const ip = clientIp(req)

  const body = await req.json().catch(() => null)
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  const input = parsed.data

  const settings = await getSettings()
  const before = await db.payoutRequest.findUnique({ where: { id: input.id } })
  if (!before) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  if (input.action === 'approve') {
    const result = await approvePayout(admin.id, input.id, settings)
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 409 })
    await logAdminAction({
      adminId: admin.id,
      action: result.awaitingSecond ? 'PAYOUT_FIRST_APPROVE' : 'PAYOUT_APPROVE',
      targetType: 'payout',
      targetId: input.id,
      before: { status: before.status },
      after: { status: result.request.status, approvedBy: result.request.approvedBy },
      ip,
    })
    securityLog('payout.approved', { payoutId: input.id, adminId: admin.id, awaitingSecond: Boolean(result.awaitingSecond) })
    return NextResponse.json({
      request: result.request,
      ...(result.awaitingSecond ? { awaitingSecondAdmin: true } : {}),
    })
  }

  if (input.action === 'reject') {
    const result = await rejectPayout(admin.id, input.id, input.reason)
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 409 })
    securityLog('payout.rejected', { payoutId: input.id, adminId: admin.id })
    await logAdminAction({
      adminId: admin.id,
      action: 'PAYOUT_REJECT',
      targetType: 'payout',
      targetId: input.id,
      before: { status: before.status },
      after: { status: 'REJECTED', reason: input.reason },
      ip,
    })
    return NextResponse.json({ request: result.request })
  }

  const result = await markPayoutPaid(admin.id, input.id, input.transactionRef, settings)
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 409 })
  await logAdminAction({
    adminId: admin.id,
    action: 'PAYOUT_PAID',
    targetType: 'payout',
    targetId: input.id,
    before: { status: before.status },
    after: { status: 'PAID', transactionRef: input.transactionRef },
    ip,
  })
  return NextResponse.json({ request: result.request })
}
