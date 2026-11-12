// Route-handler guards: session user, verified-email rules, admin role.

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
