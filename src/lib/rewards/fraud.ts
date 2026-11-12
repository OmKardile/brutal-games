// Anti-fraud: device fingerprints, IP risk checks, headless heuristics.
// IMPORTANT: every signal only raises a FraudFlag for MANUAL review —
// nothing here auto-freezes an account or auto-voids points.

import { createHash } from 'node:crypto'
import { db as defaultDb } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
import type { RewardSettings } from '@/lib/rewards/config'
import type { DB } from '@/lib/rewards/points'

export type FlagType =
  | 'DUPLICATE_DEVICE'
  | 'DUPLICATE_IP'
  | 'VPN_DATACENTER'
  | 'HEADLESS_SUSPECT'
  | 'ANOMALY'
  | 'MANUAL'

export type FlagSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

/** Client signals collected at signup/login; normalized then hashed. */
export interface DeviceSignals {
  userAgent?: string
  language?: string
  timezone?: string
  screen?: string // "WxH xDPR"
  platform?: string
  hardwareConcurrency?: number
  deviceMemory?: number
  [k: string]: unknown
}

export function fingerprintOf(signals: DeviceSignals): string {
  const norm = {
    ua: String(signals.userAgent ?? '').trim().toLowerCase(),
    lang: String(signals.language ?? '').trim().toLowerCase(),
    tz: String(signals.timezone ?? '').trim(),
    screen: String(signals.screen ?? '').trim(),
    platform: String(signals.platform ?? '').trim().toLowerCase(),
    cores: Number(signals.hardwareConcurrency) || 0,
    mem: Number(signals.deviceMemory) || 0,
  }
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex')
}

/** UA that smells automated. */
export function headlessSuspect(ua: string): boolean {
  return /headlesschrome|phantomjs|python-requests|python-urllib|^curl\/|^wget|scrapy|puppeteer|playwright|node-fetch|axios\//i.test(
    ua,
  )
}

/** IPv4 CIDR / exact-IP membership. IPv6: exact match only (documented). */
export function ipInList(ip: string, list: string): boolean {
  const entries = list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const e of entries) {
    if (e === ip) return true
    if (e.includes('/') && ip.includes('.') && e.includes('.')) {
      const [base, bitsStr] = e.split('/')
      const bits = Number(bitsStr)
      const toInt = (a: string) =>
        a.split('.').reduce((s, o) => (s << 8) + (Number(o) || 0), 0) >>> 0
      if (Number.isFinite(bits) && bits >= 0 && bits <= 32 && base.split('.').length === 4 && ip.split('.').length === 4) {
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
        if ((toInt(base) & mask) === (toInt(ip) & mask)) return true
      }
    }
  }
  return false
}

export async function flagUser(
  userId: string,
  type: FlagType,
  severity: FlagSeverity,
  details: Record<string, unknown>,
  dbx: DB = defaultDb,
): Promise<void> {
  // dedupe: don't pile up identical OPEN flags per user+type
  const dupe = await dbx.fraudFlag.findFirst({
    where: { userId, type, status: { in: ['OPEN', 'REVIEWING'] } },
  })
  if (dupe) return
  await dbx.fraudFlag.create({
    data: {
      userId,
      type,
      severity,
      details: JSON.stringify(details).slice(0, 4000),
    },
  })
}

/**
 * Register/update a device for a user and run duplicate-device + IP checks.
 * Returns the fingerprint (stored client-side for display "device known").
 */
export async function registerDevice(
  userId: string,
  signals: DeviceSignals,
  ip: string,
  settings: RewardSettings,
  dbx: PrismaClient | DB = defaultDb,
): Promise<string> {
  const fp = fingerprintOf(signals)
  const ua = String(signals.userAgent ?? '')

  await dbx.deviceFingerprint.upsert({
    where: { fingerprint_userId: { fingerprint: fp, userId } },
    update: { lastSeenAt: new Date(), ip, userAgent: ua.slice(0, 400) },
    create: { userId, fingerprint: fp, ip, userAgent: ua.slice(0, 400) },
  })

  // same device, several accounts -> flag all involved for review
  const others = await dbx.deviceFingerprint.findMany({
    where: { fingerprint: fp, userId: { not: userId } },
    select: { userId: true },
    take: 10,
  })
  if (others.length > 0) {
    await flagUser(userId, 'DUPLICATE_DEVICE', 'MEDIUM', {
      fingerprint: fp.slice(0, 16),
      otherAccounts: others.length,
    }, dbx as DB)
  }

  if (ip && ip !== 'unknown') {
    if (ipInList(ip, settings.VPN_IP_LIST)) {
      await flagUser(userId, 'VPN_DATACENTER', 'HIGH', { ip }, dbx as DB)
    }
    // many distinct accounts from one IP -> review
    const clusters = await dbx.deviceFingerprint.findMany({
      where: { ip, userId: { not: userId } },
      select: { userId: true },
    })
    const distinct = new Set(clusters.map((c) => c.userId))
    if (distinct.size >= 5) {
      await flagUser(userId, 'DUPLICATE_IP', 'MEDIUM', { ip, distinctAccounts: distinct.size }, dbx as DB)
    }
  }

  if (headlessSuspect(ua)) {
    await flagUser(userId, 'HEADLESS_SUSPECT', 'HIGH', { ua: ua.slice(0, 300) }, dbx as DB)
  }

  return fp
}
