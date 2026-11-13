import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/guard'
import { monthlyReconciliation } from '@/lib/rewards/reconciliation'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/reconciliation?month=YYYY-MM — the monthly money report:
 * Σ payouts vs Σ credited distributions per locked pool, per-user over-payment
 * checks, and a plain ok/issues verdict. Phase 6 wires mismatch alerts to the
 * notification channel; today the report is admin-facing.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Month must be YYYY-MM.' }, { status: 400 })
  }
  const report = await monthlyReconciliation(month)
  return NextResponse.json(report)
}
