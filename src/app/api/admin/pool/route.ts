import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { getSettings } from '@/lib/rewards/config'
import { lockMonth } from '@/lib/rewards/payouts'
import { csrfBlocked } from '@/lib/http'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

const SaveSchema = z.object({
  action: z.literal('save'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  netRevenueMinor: z.number().int().min(0).max(10_000_000_000),
  sharePercent: z.number().int().min(0).max(100),
})

const LockSchema = z.object({
  action: z.literal('lock'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

/** List all pools with aggregate info. */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  const pools = await db.monthlyPool.findMany({
    orderBy: { month: 'desc' },
    include: { _count: { select: { distributions: true } } },
  })
  return NextResponse.json({ pools })
}

/** Save revenue for a month (DRAFT upsert), or lock a month. */
export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user: admin, error } = await requireAdmin(req)
  if (error) return error
  const ip = clientIp(req)

  const body = await req.json().catch(() => null)
  const parsed = SaveSchema.safeParse(body).success
    ? SaveSchema.parse(body)
    : LockSchema.safeParse(body).success
      ? LockSchema.parse(body)
      : null
  if (!parsed) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })

  if (parsed.action === 'save') {
    const existing = await db.monthlyPool.findUnique({ where: { month: parsed.month } })
    if (existing?.status === 'LOCKED') {
      return NextResponse.json({ error: 'Month is locked — revenue can no longer change.' }, { status: 409 })
    }
    const pool = await db.monthlyPool.upsert({
      where: { month: parsed.month },
      update: {
        netRevenueMinor: parsed.netRevenueMinor,
        sharePercent: parsed.sharePercent,
        enteredBy: admin.id,
      },
      create: {
        month: parsed.month,
        netRevenueMinor: parsed.netRevenueMinor,
        sharePercent: parsed.sharePercent,
        enteredBy: admin.id,
      },
    })
    await logAdminAction({
      adminId: admin.id,
      action: 'POOL_SAVE',
      targetType: 'pool',
      targetId: parsed.month,
      before: existing ? { netRevenueMinor: existing.netRevenueMinor, sharePercent: existing.sharePercent } : null,
      after: { netRevenueMinor: parsed.netRevenueMinor, sharePercent: parsed.sharePercent },
      ip,
    })
    return NextResponse.json({ pool })
  }

  // lock
  const settings = await getSettings()
  const result = await lockMonth(admin.id, parsed.month, settings)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
  await logAdminAction({
    adminId: admin.id,
    action: 'POOL_LOCK',
    targetType: 'pool',
    targetId: parsed.month,
    after: { poolAmountMinor: result.computation?.poolAmountMinor ?? 0 },
    ip,
  })
  return NextResponse.json({ ok: true, computation: result.computation })
}
