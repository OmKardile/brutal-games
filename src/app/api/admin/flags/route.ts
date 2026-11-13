import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  id: z.string(),
  action: z.enum(['reviewing', 'dismiss', 'confirm']),
})

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status')
  const where = status && ['OPEN', 'REVIEWING', 'DISMISSED', 'CONFIRMED'].includes(status)
    ? { status }
    : {}
  const flags = await db.fraudFlag.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
    include: {
      user: { select: { id: true, email: true, name: true, status: true } },
    },
  })
  return NextResponse.json({ flags })
}

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user: admin, error } = await requireAdmin(req)
  if (error) return error

  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })

  const before = await db.fraudFlag.findUnique({ where: { id: parsed.data.id } })
  if (!before) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const map = {
    reviewing: 'REVIEWING',
    dismiss: 'DISMISSED',
    confirm: 'CONFIRMED',
  } as const
  const updated = await db.fraudFlag.update({
    where: { id: parsed.data.id },
    data: {
      status: map[parsed.data.action],
      resolvedAt: parsed.data.action === 'reviewing' ? null : new Date(),
      resolvedBy: admin.id,
    },
  })
  await logAdminAction({
    adminId: admin.id,
    action: `FLAG_${parsed.data.action.toUpperCase()}`,
    targetType: 'flag',
    targetId: parsed.data.id,
    before: { status: before.status },
    after: { status: updated.status },
    ip: clientIp(req),
  })
  return NextResponse.json({ flag: updated })
}
