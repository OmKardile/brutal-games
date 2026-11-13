import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), board: z.enum(['global', 'daily']), id: z.string() }),
  z.object({
    action: z.literal('remove'),
    board: z.enum(['global', 'daily']),
    id: z.string(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({ action: z.literal('restore'), board: z.enum(['global', 'daily']), id: z.string() }),
])

/** GET /api/admin/boards — the verification + moderation queue. */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const [pendingGlobal, pendingDaily, removedGlobal, removedDaily] = await Promise.all([
    db.highScore.findMany({
      where: { pending: true, removedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, email: true, name: true, status: true } } },
    }),
    db.dailyRun.findMany({
      where: { pending: true, removedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, email: true, name: true, status: true } } },
    }),
    db.highScore.findMany({
      where: { removedAt: { not: null } },
      orderBy: { removedAt: 'desc' },
      take: 50,
    }),
    db.dailyRun.findMany({
      where: { removedAt: { not: null } },
      orderBy: { removedAt: 'desc' },
      take: 50,
    }),
  ])

  return NextResponse.json({
    pendingGlobal,
    pendingDaily,
    removedGlobal,
    removedDaily,
  })
}

/**
 * POST /api/admin/boards — moderation actions (M4 fix):
 *  - verify: release a pending entry onto the board
 *  - remove: hide a confirmed-cheat entry (kept for audit; ranks recompute
 *    automatically since boards are query-computed)
 *  - restore: undo a removal
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

  try {
    if (input.board === 'global') {
      if (input.action === 'verify') {
        const row = await db.highScore.update({
          where: { id: input.id },
          data: { pending: false },
        })
        await logAdminAction({ adminId: admin.id, action: 'BOARD_VERIFY', targetType: 'board', targetId: input.id, after: { pending: false }, ip })
        return NextResponse.json({ ok: true, entry: { id: row.id, pending: row.pending } })
      }
      if (input.action === 'remove') {
        const row = await db.highScore.update({
          where: { id: input.id },
          data: { removedAt: new Date(), removedBy: admin.id, removedReason: input.reason },
        })
        await logAdminAction({ adminId: admin.id, action: 'BOARD_REMOVE', targetType: 'board', targetId: input.id, after: { reason: input.reason }, ip })
        return NextResponse.json({ ok: true, entry: { id: row.id, removedAt: row.removedAt } })
      }
      const row = await db.highScore.update({
        where: { id: input.id },
        data: { removedAt: null, removedBy: null, removedReason: null },
      })
      return NextResponse.json({ ok: true, entry: { id: row.id, removedAt: null } })
    }

    if (input.action === 'verify') {
      const row = await db.dailyRun.update({ where: { id: input.id }, data: { pending: false } })
      await logAdminAction({ adminId: admin.id, action: 'BOARD_VERIFY', targetType: 'board', targetId: input.id, after: { pending: false, board: 'daily' }, ip })
      return NextResponse.json({ ok: true, entry: { id: row.id, pending: row.pending } })
    }
    if (input.action === 'remove') {
      const row = await db.dailyRun.update({
        where: { id: input.id },
        data: { removedAt: new Date(), removedBy: admin.id, removedReason: input.reason },
      })
      await logAdminAction({ adminId: admin.id, action: 'BOARD_REMOVE', targetType: 'board', targetId: input.id, after: { reason: input.reason, board: 'daily' }, ip })
      return NextResponse.json({ ok: true, entry: { id: row.id, removedAt: row.removedAt } })
    }
    const row = await db.dailyRun.update({
      where: { id: input.id },
      data: { removedAt: null, removedBy: null, removedReason: null },
    })
    return NextResponse.json({ ok: true, entry: { id: row.id, removedAt: null } })
  } catch {
    return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
  }
}
