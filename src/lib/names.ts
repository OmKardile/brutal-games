// Display-name (callsign) policy — M2 fix.
//
// Boards accept ONE user-chosen string; it is an XSS-adjacent, impersonation-
// adjacent free-text field. Policy, applied server-side only:
//  1. sanitize: Unicode NFC, strip control/zero-width/bidi characters,
//     collapse whitespace, trim, hard cap 16 chars.
//  2. reserved names (admin/staff/support/… incl. common leetspeak) blocked.
//  3. profanity blocklist (built-in default; extend via NAME_BLOCKLIST env,
//     comma-separated, matched on leet-normalized lowercase).
//  4. uniqueness: enforced through User.nameKey (uppercase normalized) —
//     one callsign per account, one account per callsign. Ranked board
//     entries always use the ACCOUNT name, never a client-supplied string.

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'

const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'staff', 'support', 'official',
  'system', 'owner', 'root', 'brutal', 'brutalgames', 'arena', 'brutalarena',
  'help', 'security', 'team', 'contact', 'null', 'undefined', 'player',
])

const DEFAULT_BLOCKLIST = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'nigger', 'nigga',
  'faggot', 'retard', 'rape', 'pedo', 'nazi', 'hitler', 'slut', 'whore',
  'dick', 'cock', 'pussy', 'penis', 'vagina', 'boobs',
]

/** Strip everything that can hide characters or break rendering. */
export function sanitizeNameInput(raw: string): string {
  const nfc = raw.normalize('NFC')
  // invisible format characters (zero-width, bidi overrides) vanish entirely;
  // control chars and separators collapse to single spaces
  const noFormat = nfc.replace(/[\p{Cf}]/gu, '')
  const stripped = noFormat.replace(/[\p{Cc}\p{Zs}\p{Zl}\p{Zp}]+/gu, ' ').trim()
  return Array.from(stripped).slice(0, 16).join('').replace(/\s+/g, ' ').trim()
}

/** Leetspeak-fold to lowercase letters only — for MATCHING, not storage. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1|!]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z]/g, '')
}

function blocklist(): string[] {
  const extra = (process.env.NAME_BLOCKLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return [...DEFAULT_BLOCKLIST, ...extra]
}

/** Returns a user-presentable error, or null when the name is acceptable. */
export function namePolicyError(name: string): string | null {
  if (!name || name.length === 0) return 'Enter a callsign.'
  if (name.length > 16) return 'Callsign must be at most 16 characters.'
  if (!/\p{L}|\p{N}/u.test(name)) return 'Callsign must contain a letter or digit.'
  const m = normalizeForMatch(name)
  if (!m) return 'Callsign must contain letters or digits.'
  if (RESERVED.has(m)) return 'That callsign is reserved.'
  for (const word of blocklist()) {
    if (word.length >= 3 && m.includes(word)) return 'That callsign is not allowed.'
  }
  return null
}

/** Case-insensitive uniqueness key for the User.nameKey column. */
export function nameKeyOf(name: string): string {
  return normalizeForMatch(name)
}

/**
 * Generate an unclaimed callsign like "PILOT-A7F3" (deterministic retries
 * handled by the caller against User.nameKey uniqueness).
 */
export function generatedCallsign(): string {
  const hex = Array.from({ length: 4 }, () =>
    '0123456789ABCDEF'[Math.floor(Math.random() * 16)],
  ).join('')
  return `PILOT-${hex}`
}

export interface ClaimResult {
  ok: boolean
  reason?: string
  name: string
  nameKey: string
}

/**
 * Claim/refresh a user's callsign (case-insensitive unique). Returns the
 * effective name. `fallbackToGenerated` covers first ranked post without a
 * name: the account gets a PILOT-XXXX callsign automatically.
 */
export async function claimDisplayName(
  userId: string,
  desired: string | null | undefined,
  dbx: PrismaClient = defaultDb,
  fallbackToGenerated = true,
): Promise<ClaimResult> {
  if (desired) {
    const clean = sanitizeNameInput(desired)
    const err = namePolicyError(clean)
    if (err) return { ok: false, reason: err, name: '', nameKey: '' }
    const key = nameKeyOf(clean)
    const existing = await dbx.user.findFirst({
      where: { nameKey: key, id: { not: userId } },
      select: { id: true },
    })
    if (existing) return { ok: false, reason: 'Callsign already taken.', name: '', nameKey: '' }
    const user = await dbx.user.update({
      where: { id: userId },
      data: { name: clean, nameKey: key },
      select: { name: true },
    })
    return { ok: true, name: user.name ?? clean, nameKey: key }
  }

  const user = await dbx.user.findUnique({ where: { id: userId }, select: { name: true, nameKey: true } })
  if (user?.name && user.nameKey) return { ok: true, name: user.name, nameKey: user.nameKey }
  if (!fallbackToGenerated) return { ok: false, reason: 'No callsign set.', name: '', nameKey: '' }

  for (let i = 0; i < 5; i++) {
    const candidate = generatedCallsign()
    const key = nameKeyOf(candidate)
    const taken = await dbx.user.findFirst({
      where: { nameKey: key },
      select: { id: true },
    })
    if (taken) continue
    const updated = await dbx.user.update({
      where: { id: userId },
      data: { name: candidate, nameKey: key },
      select: { name: true },
    })
    return { ok: true, name: updated.name ?? candidate, nameKey: key }
  }
  return { ok: false, reason: 'Could not assign a callsign — try setting one in your profile.', name: '', nameKey: '' }
}
