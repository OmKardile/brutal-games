import { NextRequest, NextResponse } from 'next/server'
import { getSettings, updateSettings, type RewardSettings } from '@/lib/rewards/config'
import { requireAdmin } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'
import { logAdminAction } from '@/lib/audit'
import { clientIp } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  return NextResponse.json({ settings: await getSettings() })
}

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { user: admin, error } = await requireAdmin(req)
  if (error) return error

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }
  const before = await getSettings()
  const settings = await updateSettings(body as Partial<RewardSettings>)
  // audit the changed keys only (kill switches included)
  const changed: Record<string, { before: unknown; after: unknown }> = {}
  for (const k of Object.keys(settings)) {
    const b = (before as unknown as Record<string, unknown>)[k]
    const a = (settings as unknown as Record<string, unknown>)[k]
    if (JSON.stringify(a) !== JSON.stringify(b)) changed[k] = { before: b, after: a }
  }
  if (Object.keys(changed).length > 0) {
    await logAdminAction({
      adminId: admin.id,
      action: 'SETTINGS_UPDATE',
      targetType: 'setting',
      after: changed,
      ip: clientIp(req),
    })
  }
  return NextResponse.json({ settings })
}
