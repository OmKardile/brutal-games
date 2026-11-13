// Shared HTTP guards for route handlers.
//
// CSRF baseline (H7 fix): every state-changing route calls csrfBlocked(req)
// BEFORE parsing the body. Two independent checks:
//  1. Origin / Host allowlist — Origin (or Sec-Fetch-Site / Referer fallback)
//     must match the request Host or the configured APP_URL host.
//  2. Content-Type must be application/json on JSON-body mutations — a
//     cross-site form/curl post can't produce that without a CORS preflight.
// Combined with SameSite=Lax cookies this gives layered CSRF defense.

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

function allowedHosts(req: Request): Set<string> {
  const hosts = new Set<string>()
  const host = req.headers.get('host')
  if (host) hosts.add(host.toLowerCase())
  try {
    hosts.add(new URL(env.APP_URL).host.toLowerCase())
  } catch {
    // APP_URL unparseable — Host header check still applies
  }
  return hosts
}

/** Pure: does this request come from an allowed origin? */
export function sameOriginOk(req: Request): boolean {
  const hosts = allowedHosts(req)

  const origin = req.headers.get('origin')
  if (origin) {
    if (origin === 'null') return false // sandboxed/anonymous origin — never ours
    try {
      return hosts.has(new URL(origin).host.toLowerCase())
    } catch {
      return false
    }
  }

  // No Origin header: modern browsers still send Sec-Fetch-Site on requests.
  const sfs = req.headers.get('sec-fetch-site')
  if (sfs) return sfs === 'same-origin' || sfs === 'same-site' || sfs === 'none'

  // Legacy fallback: Referer.
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      return hosts.has(new URL(referer).host.toLowerCase())
    } catch {
      return false
    }
  }

  // No origin signal at all — non-browser client. Reject; our own clients
  // always send Origin on POST fetches.
  return false
}

/** Pure: is the body declared as JSON? */
export function jsonContentTypeOk(req: Request): boolean {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase().trim()
  return ct === 'application/json' || ct.startsWith('application/json;')
}

/** Returns a 403 response when the request fails the CSRF baseline, else null. */
export function csrfBlocked(req: Request): NextResponse | null {
  if (!sameOriginOk(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 })
  }
  if (!jsonContentTypeOk(req)) {
    return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 })
  }
  return null
}
