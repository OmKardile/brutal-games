import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/** Own ledger history, newest first, paginated. */
export async function GET(req: NextRequest) {
  const { user, error } = await authUser()
  if (error) return error

  const cursor = req.nextUrl.searchParams.get('cursor')
  const take = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('take')) || 25))

  const events = await db.pointEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      points: true,
      reason: true,
      note: true,
      reversalOfId: true,
      createdAt: true,
    },
  })

  const hasMore = events.length > take
  const items = hasMore ? events.slice(0, take) : events
  return NextResponse.json({ events: items, nextCursor: hasMore ? items[items.length - 1].id : null })
}
