// Absolute site origin for SEO artifacts (sitemap, canonicals, JSON-LD, OG).
// Precedence: APP_URL (explicit) → RENDER_EXTERNAL_URL (Render injects it) →
// '' (local dev — relative URLs, still valid for local testing).
// Static-export builds layer NEXT_PUBLIC_BASE_PATH on top of the origin.

export const SITE_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(
  /\/+$/,
  '',
)

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** absolute URL for a root-relative path */
export function absUrl(path: string): string {
  return `${SITE_URL}${path}`
}
