import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/** User search for the admin console. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
  const users = await db.user.findMany({
    where: q
      ? {
          OR: [{ email: { contains: q } }, { name: { contains: q } }],
        }
      : {},
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      emailVerified: true,
      adultDeclaredAt: true,
      upiId: true,
      createdAt: true,
      lastLoginAt: true,
      _count: {
        select: {
          fraudFlags: { where: { status: { in: ['OPEN', 'REVIEWING'] } } },
          payoutRequests: true,
        },
      },
    },
  })
  return NextResponse.json({ users })
}
