// TOTP 2FA for admins (RFC 6238) + secret storage at rest — zero external
// dependencies (node:crypto only). Phase 5: admin accounts MUST enroll before
// any admin action; login for ADMIN role demands a code once enrolled.
//
// - generateTotpSecret(): 20 random bytes → base32 (160-bit secret)
// - totpCode(secret, timeSec): 6-digit HMAC-SHA1 code (30s step)
// - verifyTotp(secret, code, window): accepts ±window steps (drift)
// - encryptSecret/decryptSecret: AES-256-GCM with a SESSION_SECRET-derived key
//   (the DB never holds plaintext TOTP secrets)

import { createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { env } from '@/lib/env'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(): string {
  const bytes = randomBytes(20)
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** RFC 6238: 6-digit code, SHA-1, 30-second step. */
export function totpCode(secret: string, timeSec: number = Math.floor(Date.now() / 1000)): string {
  const key = base32Decode(secret)
  const counter = Math.floor(timeSec / 30)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', key).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

/** Constant-ish comparison over the ±window steps (default ±1 = 90s total). */
export function verifyTotp(secret: string, code: string, window = 1, timeSec = Math.floor(Date.now() / 1000)): boolean {
  if (!/^\d{6}$/.test(code)) return false
  for (let drift = -window; drift <= window; drift++) {
    if (totpCode(secret, timeSec + drift * 30) === code) return true
  }
  return false
}

/** otpauth:// URI for authenticator apps (paste or scan via any QR generator). */
export function totpUri(secret: string, email: string, issuer = 'BRUTAL//GAMES'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

// ------------------------------------------------------------- secret at rest

function storageKey(): Buffer {
  // derive a stable 32-byte key from SESSION_SECRET (domain-separated)
  return createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'utf8')).update('totp-storage-v1').digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', storageKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`
}

export function decryptSecret(stored: string): string | null {
  try {
    const [ivB, encB, tagB] = stored.split('.')
    const decipher = createDecipheriv('aes-256-gcm', storageKey(), Buffer.from(ivB, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
