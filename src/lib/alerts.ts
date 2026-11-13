// Outbound security alerts (phase 6, M7).
//
// POSTs a compact JSON payload to ALERT_WEBHOOK_URL (Slack/Discord/Telegram
// webhook or any receiver). Fire-and-forget: alerting must never block or
// break the request path. When the env var is unset (default), alerts are
// only written to the structured security log — the incident runbook
// documents wiring this to a channel someone actually watches.
//
// Alert-worthy events (per the threat model): HIGH flags, risk reaching the
// auto-HOLD band, payout state changes + kill switch flips, reconciliation
// mismatches, admin logins from new IPs.

import { securityLog } from '@/lib/security-log'

let lastFail = 0

export async function alert(
  title: string,
  detail: Record<string, unknown>,
  severity: 'info' | 'warn' | 'critical' = 'warn',
): Promise<void> {
  securityLog('flag.raised', { alert: title, severity, ...detail })
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return
  // fail quietly, retry no faster than every 60s after a failure
  if (Date.now() - lastFail < 60_000 && lastFail > 0) return
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `[BRUTAL//GAMES] ${title}`,
        severity,
        detail,
        ts: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
  } catch {
    lastFail = Date.now()
  }
}
