'use client'

// Minimal session hook: fetches /api/auth/me on demand.

import { useCallback, useEffect, useState } from 'react'

export interface MeUser {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  emailVerified: boolean
  adultDeclared: boolean
  upiId: string | null
}

export interface Me {
  user: MeUser | null
  rewardsEnabled: boolean
  googleEnabled: boolean
  turnstileSiteKey: string
}

export function useSession() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      if (res.ok) setMe((await res.json()) as Me)
    } catch {
      // network hiccup — keep last state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { me, loading, refresh }
}
