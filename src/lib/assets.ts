// Base-path-aware URLs for files in /public.
//
// In dynamic mode (localhost, Render, any Node/Bun host) the base is empty and
// paths pass through unchanged. In static exports (GitHub Pages) the site is
// served from a sub-path (NEXT_PUBLIC_BASE_PATH=/repo-name at build time) and
// root-absolute asset paths would 404 — this helper prefixes them correctly.
//
// Mirrors apiUrl() in scores-client.ts, which does the same for API calls.

export const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function assetUrl(path: string): string {
  return `${ASSET_BASE}${path}`
}
