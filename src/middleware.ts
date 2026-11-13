import { NextRequest, NextResponse } from 'next/server'

// Security-headers middleware (phase 6, H2 fix).
//
// NOTE: this middleware ONLY sets response headers — authorization NEVER
// happens here (ADR-020 standing rule; authz lives inside route handlers).
//
// CSP trade-off (documented in ADR-027): the whole portal is PRERENDERED
// (static HTML), and Next.js cannot inject per-request nonces into
// statically generated pages — a nonce/'strict-dynamic' policy would break
// every page. We ship the strictest CSP that works for a fully prerendered
// Next app instead: no third-party script hosts (except the Turnstile
// challenge), no object/frame/plugin content, tight connect-src, locked
// base/form/frame ancestors. Inline scripts (Next's hydration bootstrap)
// require 'unsafe-inline' in script-src — the documented widening; XSS
// blast-radius is still capped by everything else + React's default escaping.
//
// API routes are excluded (no document, no CSP needed) as are static assets.

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export function middleware(request: NextRequest) {
  // analytics collector origin (optional, env-driven)
  let analyticsOrigin = ''
  const analytics = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT
  if (analytics) {
    try {
      analyticsOrigin = new URL(analytics).origin
    } catch {
      // malformed endpoint — ignore
    }
  }

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' ${TURNSTILE_ORIGIN}`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind compiled; inline style attrs
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${TURNSTILE_ORIGIN}${analyticsOrigin ? ` ${analyticsOrigin}` : ''}`,
    `frame-src ${TURNSTILE_ORIGIN}`, // Turnstile widget
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
    `worker-src 'self' blob:`,
    'upgrade-insecure-requests',
  ].join('; ')

  const response = NextResponse.next()

  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  )
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  response.headers.set('X-DNS-Prefetch-Control', 'off')
  return response
}

export const config = {
  matcher: [
    // pages only — skip API routes, Next internals, static files
    '/((?!api|_next/static|_next/image|images|og|favicon.ico|robots.txt|sitemap.xml|logo.svg).*)',
  ],
}
