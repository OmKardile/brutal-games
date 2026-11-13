import { NextRequest, NextResponse } from 'next/server'
import { getSettings, updateSettings, type RewardSettings } from '@/lib/rewards/config'
import { requireAdmin } from '@/lib/auth/guard'
import { csrfBlocked } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  return NextResponse.json({ settings: await getSettings() })
}

export async function POST(req: NextRequest) {
  const csrf = csrfBlocked(req)
  if (csrf) return csrf

  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }
  const settings = await updateSettings(body as Partial<RewardSettings>)
  return NextResponse.json({ settings })
}
