// Signed run-session tokens — anti-cheat Layer A (phase 3).
//
// A run token is now an HMAC-SHA256-signed payload (not just an opaque random
// string): it binds userId, game, seed, nonce and the SERVER-issued startedAt,
// and carries a key id so signing keys can rotate without killing in-flight
// runs. Verification is offline (no DB hit needed to reject garbage), but the
// authoritative state — single use, aborts, beats — still lives in the
// PlaySession row keyed by sha256(token).
//
// Token format:  <base64url(payloadJson)>.<hex(hmac)>
//
// Keys: env RUN_TOKEN_KEYS="id1:hexSecret,id2:hexSecret" — the LAST entry is
// the current signing key; earlier entries verify only (rotation). When unset,
// a key is derived from SESSION_SECRET (kid "ss-v1") so local dev and
// single-key deploys need no extra config.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

export interface RunTokenPayload {
  uid: string
  game: string | null
  seed: number | null
  /** CSPRNG nonce — every run token is unique even for identical runs */
  nonce: string
  /** server clock at run start (ms epoch) — the only trusted time */
  startedAt: number
  /** signing key id (rotation support) */
  kid: string
}

interface KeyEntry {
  id: string
  secret: Buffer
}

let cachedKeys: { entries: KeyEntry[]; current: KeyEntry; raw: string } | null = null
let cachedAt = 0

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}

function hmac(secret: Buffer, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

function parseKeys(): { entries: KeyEntry[]; current: KeyEntry } {
  const raw = process.env.RUN_TOKEN_KEYS ?? ''
  // cache keyed by the env value itself: rotation applies the moment the
  // env changes, unchanged values skip re-parsing for 60s
  if (cachedKeys && cachedKeys.raw === raw && Date.now() - cachedAt < 60_000) {
    return { entries: cachedKeys.entries, current: cachedKeys.current }
  }

  const entries: KeyEntry[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const id = trimmed.slice(0, idx).trim()
    const secretHex = trimmed.slice(idx + 1).trim()
    if (!id || secretHex.length < 32) continue
    entries.push({ id, secret: Buffer.from(secretHex, 'hex') })
  }
  if (entries.length === 0) {
    // derived fallback: HMAC key = HMAC(SESSION_SECRET, 'run-token-v1')
    const derived = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'utf8'))
      .update('run-token-v1')
      .digest()
    entries.push({ id: 'ss-v1', secret: derived })
  }
  cachedKeys = { entries, current: entries[entries.length - 1], raw }
  cachedAt = Date.now()
  return cachedKeys
}

export function currentKeyId(): string {
  return parseKeys().current.id
}

/** Sign a run payload with the current key. */
export function signRunToken(payload: Omit<RunTokenPayload, 'kid' | 'nonce'> & { nonce?: string }): string {
  const keys = parseKeys()
  const full: RunTokenPayload = {
    ...payload,
    nonce: payload.nonce ?? randomBytes(12).toString('hex'),
    kid: keys.current.id,
  }
  const body = b64url(JSON.stringify(full))
  return `${body}.${hmac(keys.current.secret, body)}`
}

/**
 * Verify signature (any known key). Returns the payload, or null for
 * malformed/forged/tampered tokens. Does NOT check expiry or DB state.
 */
export function verifyRunToken(token: string): RunTokenPayload | null {
  if (typeof token !== 'string' || token.length > 1024) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^[0-9a-f]{64}$/.test(sig)) return null
  const keys = parseKeys()
  const sigBuf = Buffer.from(sig, 'hex')
  for (const k of keys.entries) {
    const expected = Buffer.from(hmac(k.secret, body), 'hex')
    if (expected.length === sigBuf.length && timingSafeEqual(expected, sigBuf)) {
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RunTokenPayload
        if (
          typeof payload?.uid === 'string' &&
          typeof payload?.nonce === 'string' &&
          typeof payload?.startedAt === 'number' &&
          typeof payload?.kid === 'string'
        ) {
          return payload
        }
        return null
      } catch {
        return null
      }
    }
  }
  return null
}

/** True when the token's key id is the current signing key (rotation stats). */
export function tokenUsesCurrentKey(payload: RunTokenPayload): boolean {
  return payload.kid === currentKeyId()
}
