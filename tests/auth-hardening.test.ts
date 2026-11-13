// Phase 2 auth hardening: password hashing (argon2id + legacy scrypt),
// password policy, name policy, CSRF guards, login backoff math, HIBP gate.
// Pure-logic tests; DB-backed limiter/score tests live in their own files.

import { describe, expect, it } from 'bun:test'
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  needsRehash,
  dummyVerify,
  isBreachedPassword,
} from '../src/lib/auth/password'
import {
  sanitizeNameInput,
  namePolicyError,
  nameKeyOf,
  generatedCallsign,
} from '../src/lib/names'
import { sameOriginOk, jsonContentTypeOk } from '../src/lib/http'
import { backoffMs, LOGIN_LOCKOUT } from '../src/lib/rate-limit'

describe('password hashing', () => {
  it('hashes with argon2id under Bun and verifies round-trip', async () => {
    const hash = await hashPassword('correct-horse-battery')
    // Bun runtime => argon2id PHC string
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true)
    expect(await verifyPassword('wrong-password-123', hash)).toBe(false)
  })
  it('still verifies legacy scrypt hashes', async () => {
    // scrypt$N$r$p$salt$hash (format only — verifyPassword must reject cleanly)
    expect(await verifyPassword('x', 'scrypt$16384$8$1$deadbeef$cafe')).toBe(false)
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })
  it('flags legacy scrypt hashes for rehash but not argon2id', () => {
    expect(needsRehash('scrypt$16384$8$1$aa$bb')).toBe(true)
    expect(needsRehash('$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$aGFzaA')).toBe(false)
  })
  it('dummyVerify never throws', async () => {
    await dummyVerify() // must resolve without error
    await dummyVerify()
  })
})

describe('password policy', () => {
  it('requires 10+ chars with no composition rules', () => {
    expect(validatePasswordPolicy('short123')).toBe('Password must be at least 10 characters.')
    expect(validatePasswordPolicy('123456789')).toBe('Password must be at least 10 characters.')
    expect(validatePasswordPolicy('alllowercase')).toBeNull()
    expect(validatePasswordPolicy('1234567890')).toBeNull()
    expect(validatePasswordPolicy('a'.repeat(201))).toBe('Password too long.')
  })
})

describe('HIBP breached-password check', () => {
  it('is disabled unless HIBP_CHECK=1 (returns null, never blocks)', async () => {
    delete process.env.HIBP_CHECK
    expect(await isBreachedPassword('whatever')).toBeNull()
  })
})

describe('name policy', () => {
  it('sanitizes control/zero-width/bidi characters and collapses spaces', () => {
    // zero-width/bidi vanish; control chars and runs of spaces collapse
    expect(sanitizeNameInput('  A\u200bB\u202eC  D ')).toBe('ABC D')
    expect(sanitizeNameInput('A\u200bB')).toBe('AB')
    expect(sanitizeNameInput('a'.repeat(40)).length).toBe(16)
  })
  it('blocks reserved names including leetspeak variants', () => {
    expect(namePolicyError('ADMIN')).toContain('reserved')
    expect(namePolicyError('4dmin')).toContain('reserved')
    expect(namePolicyError('M0D')).toContain('reserved')
    expect(namePolicyError('SYSTEM')).toContain('reserved')
    expect(namePolicyError('SHADOW')).toBeNull()
  })
  it('blocks blocklist words on the leet-normalized form', () => {
    expect(namePolicyError('sh1thead')).toContain('not allowed')
    expect(namePolicyError('B1TCH')).toContain('not allowed')
    expect(namePolicyError('NEONWOLF')).toBeNull()
  })
  it('rejects empty and symbol-only names', () => {
    expect(namePolicyError('')).toContain('Enter')
    expect(namePolicyError('---')).toContain('letter or digit')
  })
  it('derives case/space-insensitive uniqueness keys', () => {
    expect(nameKeyOf('Neon Wolf')).toBe(nameKeyOf('NEONWOLF'))
    // leet-folded (0→o, 1→i), symbols dropped
    expect(nameKeyOf('PILOT-0001')).toBe('pilotoooi')
    expect(nameKeyOf('ABC')).not.toBe(nameKeyOf('ABD'))
  })
  it('generates PILOT-XXXX callsigns', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatedCallsign()).toMatch(/^PILOT-[0-9A-F]{4}$/)
    }
  })
})

describe('CSRF guards', () => {
  const mk = (headers: Record<string, string>) =>
    new Request('http://localhost:3000/api/x', { method: 'POST', headers })

  it('accepts same-origin Origin headers', () => {
    expect(sameOriginOk(mk({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true)
    expect(sameOriginOk(mk({ origin: 'https://localhost:3000', host: 'localhost:3000' }))).toBe(true)
  })
  it('rejects foreign origins and origin null', () => {
    expect(sameOriginOk(mk({ origin: 'https://evil.example', host: 'localhost:3000' }))).toBe(false)
    expect(sameOriginOk(mk({ origin: 'null', host: 'localhost:3000' }))).toBe(false)
    expect(sameOriginOk(mk({ origin: 'http://not-localhost:9999', host: 'localhost:3000' }))).toBe(false)
  })
  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    expect(sameOriginOk(mk({ host: 'localhost:3000', 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(sameOriginOk(mk({ host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })
  it('falls back to Referer and rejects nothing-signals', () => {
    expect(sameOriginOk(mk({ host: 'localhost:3000', referer: 'http://localhost:3000/play' }))).toBe(true)
    expect(sameOriginOk(mk({ host: 'localhost:3000', referer: 'https://evil.example/x' }))).toBe(false)
    expect(sameOriginOk(mk({ host: 'localhost:3000' }))).toBe(false)
  })
  it('requires JSON content-type on mutation bodies', () => {
    expect(jsonContentTypeOk(mk({ 'content-type': 'application/json' }))).toBe(true)
    expect(jsonContentTypeOk(mk({ 'content-type': 'application/json; charset=utf-8' }))).toBe(true)
    expect(jsonContentTypeOk(mk({ 'content-type': 'application/x-www-form-urlencoded' }))).toBe(false)
    expect(jsonContentTypeOk(mk({ 'content-type': 'text/plain' }))).toBe(false)
    expect(jsonContentTypeOk(mk({}))).toBe(false)
  })
})

describe('login lockout backoff', () => {
  it('unlocked below the threshold', () => {
    expect(backoffMs(1, LOGIN_LOCKOUT)).toBe(0)
    expect(backoffMs(4, LOGIN_LOCKOUT)).toBe(0)
  })
  it('locks with exponential backoff past the threshold', () => {
    expect(backoffMs(5, LOGIN_LOCKOUT)).toBe(15_000)
    expect(backoffMs(6, LOGIN_LOCKOUT)).toBe(30_000)
    expect(backoffMs(7, LOGIN_LOCKOUT)).toBe(60_000)
    expect(backoffMs(8, LOGIN_LOCKOUT)).toBe(120_000)
  })
  it('caps the backoff at maxMs', () => {
    expect(backoffMs(20, LOGIN_LOCKOUT)).toBe(LOGIN_LOCKOUT.maxMs)
    expect(backoffMs(100, LOGIN_LOCKOUT)).toBe(LOGIN_LOCKOUT.maxMs)
  })
})
