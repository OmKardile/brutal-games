// Route-handler guards: session user, verified-email rules, admin role.
// Authorization ALWAYS happens here (inside the route handler), never in
// middleware alone — see decisions.md (CVE-2025-29927 class).

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
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

export async function requireAdmin(): Promise<
  { user: User; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const { user, error } = await authUser()
  if (error) return { error }
  if (user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) }
  }
  return { user }
}
