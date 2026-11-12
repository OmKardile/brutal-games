// Password hashing with node:crypto scrypt — zero external dependencies.
// Format: scrypt$N$r$p$saltHex$hashHex

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'
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

export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (pw.length > 200) return 'Password too long.'
  return null
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [ , nStr, rStr, pStr, saltHex, hashHex ] = parts
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
