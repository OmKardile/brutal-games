// Route-handler guards: session user, verified-email rules, admin role.
// Authorization ALWAYS happens here (inside the route handler), never in
// middleware alone — see decisions.md (CVE-2025-29927 class).
//
// Phase 5 hardening for requireAdmin:
//   1. ADMIN role (as before)
//   2. TOTP enrolled — admins MUST enroll before any admin action
//   3. short-lived admin token cookie (issued at login with password+TOTP)
//   4. optional IP allowlist via ADMIN_IP_ALLOWLIST (comma list of IPs/CIDRs)

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { hasValidAdminToken } from '@/lib/auth/admin-session'
import { clientIp } from '@/lib/env'
import { ipInList } from '@/lib/rewards/fraud'
import type { User } from '@prisma/client'

export async function authUser(): Promise<
  { user: User; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const user = await getSessionUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Login required.' }, { status: 401 }) }
  }
  // L3 fix: frozen accounts lose authenticated access everywhere; an admin
  // must unfreeze before the user can act again (freeze also revokes sessions).
  if (user.status !== 'ACTIVE') {
    return { error: NextResponse.json({ error: 'Account frozen.' }, { status: 403 }) }
  }
  return { user }
}

/** Enrollment routes are reachable for admins WITHOUT a token (forced setup). */
export async function requireAdminForTotp(): Promise<
  { user: User; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const { user, error } = await authUser()
  if (error) return { error }
  if (user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) }
  }
  return { user }
}

export async function requireAdmin(req?: NextRequest): Promise<
  { user: User; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const { user, error } = await authUser()
  if (error) return { error }
  if (user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) }
  }
  // 1) mandatory TOTP enrollment (setup stores the secret; enable verifies it)
  if (!user.totpSecret || !user.totpEnabledAt) {
    return {
      error: NextResponse.json(
        { error: 'Two-factor authentication setup required.', code: 'TOTP_SETUP_REQUIRED' },
        { status: 403 },
      ),
    }
  }
  // 2) short-lived admin session token (password+TOTP at login)
  if (!(await hasValidAdminToken(user.id))) {
    return {
      error: NextResponse.json(
        { error: 'Admin session expired — log in again with your 2FA code.', code: 'ADMIN_SESSION_EXPIRED' },
        { status: 401 },
      ),
    }
  }
  // 3) optional IP allowlist (ADMIN_IP_ALLOWLIST="1.2.3.4,10.0.0.0/8")
  const allowlist = process.env.ADMIN_IP_ALLOWLIST ?? ''
  if (allowlist && req) {
    const ip = clientIp(req)
    if (ip !== 'direct' && !ipInList(ip, allowlist)) {
      return {
        error: NextResponse.json(
          { error: 'Admin access not allowed from this network.' },
          { status: 403 },
        ),
      }
    }
  }
  return { user }
}
