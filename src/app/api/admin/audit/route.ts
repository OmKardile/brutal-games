import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/** GET /api/admin/audit — the append-only admin action trail (newest first). */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const rows = await db.adminAudit.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      admin: { select: { id: true, email: true, name: true } },
    },
  })
  return NextResponse.json({ audit: rows })
}
