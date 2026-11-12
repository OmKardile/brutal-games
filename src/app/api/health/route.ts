import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Liveness + DB readiness probe (Render health check hits this).
export async function GET() {
  try {
    await db.$queryRawUnsafe('SELECT 1')
    return NextResponse.json({ ok: true, db: 'up' })
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
