// Structured security event log (phase 6, M7).
//
// One JSON line per event to stdout (Render/container logs pick it up):
//   {"ts":"...","event":"auth.login_failed","userId":"...","...":...}
// Rules: NO secrets, NO PII beyond opaque user ids / hashed IPs. The durable
// money-trail is AdminAudit; this stream is for dashboards + alerting.
// Retention is the platform's log retention (documented: 90-day target —
// export alerts/webhook payloads if longer retention is needed).

type SecurityEvent =
  | 'auth.login_failed'
  | 'auth.login_locked'
  | 'auth.login_success'
  | 'auth.signup'
  | 'auth.password_reset'
  | 'auth.freeze'
  | 'flag.raised'
  | 'risk.high'
  | 'payout.requested'
  | 'payout.approved'
  | 'payout.rejected'
  | 'payout.paid'
  | 'payout.kill_switch'
  | 'admin.login_new_ip'
  | 'reconciliation.mismatch'
  | 'security.csp_violation'

export function securityLog(
  event: SecurityEvent,
  data: Record<string, unknown> = {},
): void {
  // never log secrets or raw PII; ids + hashes only (enforced by convention,
  // reviewed at PR time per SECURITY.md checklist)
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data })
  console.log(line)
}
