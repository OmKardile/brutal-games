// Append-only admin audit trail (phase 5). Every admin mutation writes a row:
// who / what / when / target / before+after snapshots. Never updated, never
// deleted. IP is recorded from the trusted-proxy parser (hashed display only
// in UIs — the raw value stays server-side).

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'

export interface AuditInput {
  adminId: string
  action: string
  targetType?: string
  targetId?: string
  before?: unknown
  after?: unknown
  ip?: string
}

export async function logAdminAction(
  input: AuditInput,
  dbx: PrismaClient = defaultDb,
): Promise<void> {
  const snap = (v: unknown) =>
    v === undefined ? undefined : JSON.stringify(v).slice(0, 4000)
  await dbx.adminAudit
    .create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: snap(input.before),
        after: snap(input.after),
        ip: input.ip,
      },
    })
    .catch((err) => {
      // the audit trail must never break the action itself — but be loud
      console.error('[audit] failed to write', input.action, err)
    })
}
