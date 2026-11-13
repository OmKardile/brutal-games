// Password hashing.
//  - New hashes: argon2id via Bun.password (production runs on Bun — see
//    Dockerfile/render.yaml). PHC-format string, no manual parameters.
//  - Legacy hashes (format scrypt$N$r$p$saltHex$hashHex) remain verifiable;
//    needsRehash() lets the login route transparently upgrade them.
//  - node:crypto scrypt is the fallback for non-Bun dev servers; those hashes
//    carry the legacy marker and get upgraded to argon2id on first login.
// Policy: min length 10 (was 8), NO composition rules, max 200.

import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

const N = 16384
const r = 8
const p = 1
const KEYLEN = 64

// Bun's argon2id implementation, resolved through globalThis so this file
// also typechecks/runs on a plain-Node dev server (where it stays undefined
// and we fall back to scrypt).
interface BunPasswordLike {
  hash(password: string, opts?: { algorithm: 'argon2id' | 'bcrypt' }): Promise<string>
  verify(password: string, hash: string): Promise<boolean>
}
const bunRuntime = globalThis as unknown as { Bun?: { password?: BunPasswordLike } }
const bunPassword: BunPasswordLike | undefined = bunRuntime.Bun?.password

export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.'
  if (pw.length > 200) return 'Password too long.'
  return null
}

export async function hashPassword(password: string): Promise<string> {
  if (bunPassword) {
    return bunPassword.hash(password, { algorithm: 'argon2id' })
  }
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** True when the stored hash should be upgraded to argon2id at next login
 *  (only meaningful on the Bun runtime, which can produce argon2id). */
export function needsRehash(stored: string): boolean {
  return Boolean(bunPassword) && stored.startsWith('scrypt$')
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const actual = await scrypt(password, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('scrypt$')) return verifyScrypt(password, stored)
  if (stored.startsWith('$argon2')) {
    if (!bunPassword) {
      // argon2 hashes can only be verified under Bun (production runtime).
      console.error('[auth] argon2 hash encountered on a non-Bun runtime — cannot verify')
      return false
    }
    try {
      return await bunPassword.verify(password, stored)
    } catch {
      return false
    }
  }
  return false
}

// A real argon2id hash of a random string — verified against when the user
// does not exist, so "wrong email" and "wrong password" take the same time.
let dummyHashPromise: Promise<string> | null = null
export async function dummyVerify(): Promise<void> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('dummy-verify-timing-equalizer')
  }
  try {
    await verifyPassword('definitely-not-the-password', await dummyHashPromise)
  } catch {
    // never throw from the timing equalizer
  }
}

/**
 * Optional breached-password check via the HIBP k-anonymity range API
 * (only the first 5 hex chars of the SHA-1 ever leave the server).
 * Disabled unless HIBP_CHECK=1; network errors fail OPEN (returns null)
 * so availability never depends on a third party.
 */
export async function isBreachedPassword(password: string): Promise<boolean | null> {
  if (process.env.HIBP_CHECK !== '1') return null
  try {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()
    const prefix = sha1.slice(0, 5)
    const suffix = sha1.slice(5)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    })
    if (!res.ok) return null
    const body = await res.text()
    for (const line of body.split('\n')) {
      const [hashSuffix] = line.split(':')
      if (hashSuffix === suffix) return true
    }
    return false
  } catch {
    return null
  }
}
