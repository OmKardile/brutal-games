// BRUTAL // ARENA — central env access. Fails soft in dev, logs what's missing.

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) {
    // Only crash on genuinely required vars; everything else degrades.
    throw new Error(`Missing required env var: ${name}`)
  }
  return v
}

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
    return process.env.SESSION_SECRET ?? 'dev-insecure-session-secret'
  },
  get isProd() {
    return process.env.NODE_ENV === 'production'
  },
  /** Turnstile keys. When the secret is absent, captcha checks are bypassed (dev). */
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

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
