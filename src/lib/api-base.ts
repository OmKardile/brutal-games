// Base-path-aware API URL helper, shared by every client-side fetcher.
// (Split out of scores-client so run-session-client can use it without a
// circular import.)

export const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
