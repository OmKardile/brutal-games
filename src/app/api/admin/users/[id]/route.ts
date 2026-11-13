import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { voidEvents, lifetimePoints } from '@/lib/rewards/points'
import { rewardBalance } from '@/lib/rewards/payouts'
import { destroyAllUserSessions } from '@/lib/auth/session'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'
import { securityLog } from '@/lib/security-log'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('freeze') }),
  z.object({ action: z.literal('unfreeze') }),
  z.object({
    action: z.literal('void'),
    eventIds: z.array(z.string()).min(1).max(200),
    reason: z.string().trim().min(3).max(500),
  }),
])

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(_req)
  if (error) return error
  const { id } = await ctx.params

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, status: true,
      emailVerified: true, adultDeclaredAt: true, upiId: true,
      createdAt: true, lastLoginAt: true,
    },
  })
  if (!user) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const [ledger, balance, totalPoints, payouts, flags, distributions, devices, activities] =
    await Promise.all([
      db.pointEvent.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      rewardBalance(id),
      lifetimePoints(id),
      db.payoutRequest.findMany({ where: { userId: id }, orderBy: { requestedAt: 'desc' }, take: 20 }),
      db.fraudFlag.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      db.poolDistribution.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 24,
        include: { pool: { select: { month: true, status: true } } },
      }),
      db.deviceFingerprint.findMany({ where: { userId: id }, take: 10 }),
      db.dailyActivity.findMany({ where: { userId: id }, orderBy: { date: 'desc' }, take: 30 }),
    ])

  return NextResponse.json({
    user,
    ledger,
    balance,
    totalPoints,
    payouts,
    flags,
    distributions,
    devices: devices.map((d) => ({ ...d, fingerprint: d.fingerprint.slice(0, 16) })),
    activities,
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user: admin, error } = await requireAdmin(req)
  if (error) return error
  const { id } = await ctx.params
  const ip = clientIp(req)

  const body = await req.json().catch(() => null)
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })

  const target = await db.user.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  if (parsed.data.action === 'freeze') {
    const updated = await db.user.update({ where: { id }, data: { status: 'FROZEN' } })
    // full invalidation: freeze also revokes every session (L3 companion fix)
    await destroyAllUserSessions(id).catch(() => undefined)
    securityLog('auth.freeze', { userId: id, adminId: admin.id })
    await logAdminAction({ adminId: admin.id, action: 'USER_FREEZE', targetType: 'user', targetId: id, before: { status: 'ACTIVE' }, after: { status: 'FROZEN' }, ip })
    return NextResponse.json({ ok: true, status: updated.status })
  }
  if (parsed.data.action === 'unfreeze') {
    const updated = await db.user.update({ where: { id }, data: { status: 'ACTIVE' } })
    await logAdminAction({ adminId: admin.id, action: 'USER_UNFREEZE', targetType: 'user', targetId: id, before: { status: 'FROZEN' }, after: { status: 'ACTIVE' }, ip })
    return NextResponse.json({ ok: true, status: updated.status })
  }

  const result = await voidEvents(admin.id, id, parsed.data.eventIds, parsed.data.reason)
  await logAdminAction({ adminId: admin.id, action: 'POINTS_VOID', targetType: 'user', targetId: id, after: { eventIds: parsed.data.eventIds.slice(0, 50), reason: parsed.data.reason }, ip })
  return NextResponse.json(result)
}
