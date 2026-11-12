import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { payoutInclude } from '@/lib/rewards/payouts'

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
  const { error } = await requireAdmin()
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

export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => null)
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  const input = parsed.data

  const request = await db.payoutRequest.findUnique({ where: { id: input.id } })
  if (!request) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  if (input.action === 'approve') {
    if (request.status !== 'PENDING') {
      return NextResponse.json({ error: 'Only PENDING requests can be approved.' }, { status: 409 })
    }
    if (request.holdUntil && request.holdUntil.getTime() > Date.now()) {
      return NextResponse.json(
        { error: `Hold period active until ${request.holdUntil.toISOString()}.` },
        { status: 409 },
      )
    }
    const updated = await db.payoutRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', reviewedBy: admin.id, reviewedAt: new Date() },
    })
    return NextResponse.json({ request: updated })
  }

  if (input.action === 'reject') {
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Only PENDING/APPROVED requests can be rejected.' }, { status: 409 })
    }
    const updated = await db.payoutRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        rejectedReason: input.reason,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      },
    })
    // freed money returns to the pool's voided counter (stays unpaid)
    await db.monthlyPool
      .updateMany({
        where: { status: 'LOCKED', distributions: { some: { userId: request.userId } } },
        data: { voidedMinor: { increment: request.amountMinor } },
      })
      .catch(() => undefined)
    return NextResponse.json({ request: updated })
  }

  // paid
  if (request.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Only APPROVED requests can be marked paid.' }, { status: 409 })
  }
  const updated = await db.payoutRequest.update({
    where: { id: request.id },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      transactionRef: input.transactionRef,
    },
  })
  return NextResponse.json({ request: updated })
}
