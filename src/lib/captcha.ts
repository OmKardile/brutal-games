// Cloudflare Turnstile verification. When TURNSTILE_SECRET_KEY is unset
// (local dev), checks are bypassed and a warning is logged once.

import { env } from '@/lib/env'
import { clientIp } from '@/lib/env'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

let warned = false

export function turnstileEnabled(): boolean {
  return env.turnstile.enabled
}

export async function verifyTurnstile(token: string | undefined, req?: Request): Promise<boolean> {
  if (!env.turnstile.enabled) {
    if (!warned) {
      console.warn('[captcha] TURNSTILE_SECRET_KEY not set — captcha bypass enabled (dev only)')
      warned = true
    }
    return true
  }
  if (!token) return false
  try {
    const body = new URLSearchParams({
      secret: env.turnstile.secretKey,
      response: token,
    })
    const ip = req ? clientIp(req) : ''
    if (ip && ip !== 'unknown') body.set('remoteip', ip)
    const res = await fetch(SITEVERIFY, { method: 'POST', body })
    if (!res.ok) return false
    const data = (await res.json()) as { success: boolean }
    return data.success === true
  } catch (err) {
    // Network failure reaching Cloudflare. Fail CLOSED in production.
    // In dev (e.g. offline sandbox) fail open with a loud warning so flows
    // remain testable — documented in technical-documentation.md.
    if (env.isProd) return false
    console.warn('[captcha] siteverify unreachable in dev — accepting token', err)
    return true
  }
}
