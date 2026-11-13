// BRUTAL // ARENA — central env access. Fails soft in dev, HARD in production
// for security-critical secrets (no code fallbacks for SESSION_SECRET there).

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) {
    // Only crash on genuinely required vars; everything else degrades.
    throw new Error(`Missing required env var: ${name}`)
  }
  return v
}

const PRIVATE_V4 = [
  { base: '10.0.0.0', bits: 8 },
  { base: '172.16.0.0', bits: 12 },
  { base: '192.168.0.0', bits: 16 },
  { base: '127.0.0.0', bits: 8 },
  { base: '169.254.0.0', bits: 16 },
]

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((s, o) => (s << 8) + (Number(o) || 0), 0) >>> 0
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true
  if (!ip.includes('.') || ip.split('.').length !== 4) return false
  const n = v4ToInt(ip)
  for (const { base, bits } of PRIVATE_V4) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((v4ToInt(base) & mask) === (n & mask)) return true
  }
  return false
}

function extraTrustedProxies(): string[] {
  return (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isTrustedHop(ip: string): boolean {
  if (isPrivateIp(ip)) return true
  const list = extraTrustedProxies()
  for (const e of list) {
    if (e === ip) return true
    if (e.includes('/') && ip.includes('.') && e.includes('.')) {
      const [base, bitsStr] = e.split('/')
      const bits = Number(bitsStr)
      if (Number.isFinite(bits) && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
        if ((v4ToInt(base) & mask) === (v4ToInt(ip) & mask)) return true
      }
    }
  }
  return false
}

let warnedNoProxy = false

export const env = {
  get DATABASE_URL() {
    return req('DATABASE_URL')
  },
  get APP_URL() {
    // RENDER_EXTERNAL_URL is injected by Render (https://<service>.onrender.com)
    // so the blueprint deploys without manual configuration.
    return (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  },
  get SESSION_SECRET() {
    const v = process.env.SESSION_SECRET
    if (process.env.NODE_ENV === 'production') {
      // C1 fix: no silent weak fallback in production. Fail hard at first use.
      if (!v || v.length < 32) {
        throw new Error(
          'SESSION_SECRET must be set to at least 32 random characters in production. ' +
            'Generate: bun -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        )
      }
      return v
    }
    return v ?? 'dev-insecure-session-secret'
  },
  get isProd() {
    return process.env.NODE_ENV === 'production'
  },
  /**
   * True when the app sits behind a reverse proxy (Caddy/Render/…) that sets
   * X-Forwarded-For / X-Real-IP. When false, client-supplied forwarding
   * headers are IGNORED (they are trivially spoofable) and every direct
   * client shares the 'direct' rate-limit bucket. Set TRUSTED_PROXY=1 when
   * deploying behind a proxy — see technical-documentation.md.
   */
  get trustedProxy() {
    return /^(1|true|yes)$/i.test(process.env.TRUSTED_PROXY ?? '')
  },
  turnstile: {
    get siteKey() {
      return process.env.TURNSTILE_SITE_KEY ?? ''
    },
    get secretKey() {
      return process.env.TURNSTILE_SECRET_KEY ?? ''
    },
    get enabled() {
      return Boolean(process.env.TURNSTILE_SECRET_KEY)
    },
  },
  mail: {
    get resendKey() {
      return process.env.RESEND_API_KEY ?? ''
    },
    get brevoKey() {
      return process.env.BREVO_API_KEY ?? ''
    },
    get from() {
      return process.env.MAIL_FROM ?? 'BRUTAL//ARENA <noreply@localhost>'
    },
    get configured() {
      return Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY)
    },
  },
  google: {
    get clientId() {
      return process.env.GOOGLE_CLIENT_ID ?? ''
    },
    get clientSecret() {
      return process.env.GOOGLE_CLIENT_SECRET ?? ''
    },
    get enabled() {
      return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    },
  },
}

/**
 * Client IP for rate limiting / audit. H6 fix:
 *  - TRUSTED_PROXY unset  -> forwarding headers are IGNORED ('direct').
 *    Fails safe: a misconfigured direct exposure cannot spoof bucket keys.
 *  - TRUSTED_PROXY=1     -> walk X-Forwarded-For from the RIGHT, skipping
 *    trusted hops (private ranges + TRUSTED_PROXIES list); the first
 *    untrusted hop is the real client. Immune to client-injected leftmost
 *    entries, with or without overwrite/append proxy semantics.
 */
export function clientIp(req: Request): string {
  if (!env.trustedProxy) {
    if (!warnedNoProxy && req.headers.get('x-forwarded-for')) {
      warnedNoProxy = true
      console.warn(
        '[env] X-Forwarded-For present but TRUSTED_PROXY is not set — header ignored ' +
          '(all direct clients share one rate-limit bucket). Set TRUSTED_PROXY=1 behind a reverse proxy.',
      )
    }
    return 'direct'
  }
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isTrustedHop(hops[i])) return hops[i]
    }
    return hops[0] ?? 'direct' // every hop trusted — unusual; take leftmost
  }
  const real = req.headers.get('x-real-ip')
  if (real && !isTrustedHop(real)) return real
  return 'direct'
}
