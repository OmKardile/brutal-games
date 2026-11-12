// Point ledger service. The ledger is append-only: rows are never edited or
// deleted. Corrections are new negative rows (ADMIN_VOID) linked via
// reversalOfId. Every award is idempotent by key. All writes go through
// awardPoints()/voidEvents() — never db.pointEvent.create directly.
//
// Awarding consumes the per-day cap (DailyActivity, IST days). The daily
// login streak is awarded automatically with the first points of a day.

import { db as defaultDb } from '@/lib/db'
import type { PrismaClient, PointEvent, User } from '@prisma/client'
import type { RewardSettings } from '@/lib/rewards/config'
import { istDateKey, istDayRangeUtc, istMonthRangeUtc, istYesterdayKey } from '@/lib/rewards/ist'

export type DB = PrismaClient

export type PointReason =
  | 'PLAY_TIME'
  | 'LOGIN_STREAK'
  | 'RUN_COMPLETION'
  | 'DAILY_CHALLENGE'
  | 'ADMIN_VOID'

export interface AwardInput {
  userId: string
  points: number // > 0
  reason: Exclude<PointReason, 'ADMIN_VOID'>
  idempotencyKey: string
  note?: string
  meta?: Record<string, unknown>
}

export type AwardResult =
  | { kind: 'awarded'; event: PointEvent; points: number }
  | { kind: 'duplicate'; event: PointEvent | null }
  | { kind: 'daily_cap'; points: number }
  | { kind: 'blocked'; reason: 'DISABLED' | 'FROZEN' | 'NO_CONSENT' }

export interface AwardContext {
  settings: RewardSettings
  user: Pick<User, 'id' | 'status' | 'adultDeclaredAt'>
  now?: Date
}

/** Pure: how many points fit under the daily cap. */
export function clampByDailyCap(
  alreadyEarned: number,
  requested: number,
  cap: number,
): number {
  if (requested <= 0 || cap <= 0) return 0
  return Math.max(0, Math.min(requested, cap - alreadyEarned))
}

/** Pure: streak award for the Nth consecutive day. */
export function streakAward(streakDay: number, base: number, max: number): number {
  if (streakDay <= 0) return 0
  return Math.min(max, base + (streakDay - 1) * 5)
}

async function computeStreakLen(dbx: DB, userId: string, todayKey: string): Promise<number> {
  // walk backwards from yesterday while the day has any activity row
  let cur = todayKey
  let len = 0
  for (let i = 0; i < 400; i++) {
    cur = istYesterdayKey(cur)
    const exists = await dbx.dailyActivity.findFirst({
      where: { userId, date: cur },
      select: { id: true },
    })
    if (!exists) break
    len++
  }
  // if yesterday had no activity, streak restarts at 1 today
  return len + 1
}

export async function awardPoints(
  ctx: AwardContext,
  input: AwardInput,
  dbx: DB = defaultDb,
): Promise<AwardResult> {
  const now = ctx.now ?? new Date()

  if (!ctx.settings.REWARDS_ENABLED) return { kind: 'blocked', reason: 'DISABLED' }
  if (ctx.user.status !== 'ACTIVE') return { kind: 'blocked', reason: 'FROZEN' }
  if (!ctx.user.adultDeclaredAt) return { kind: 'blocked', reason: 'NO_CONSENT' }
  if (!Number.isInteger(input.points) || input.points <= 0) {
    throw new Error('awardPoints: points must be a positive integer')
  }

  // idempotency — replay returns the original event, never double-awards
  const existing = await dbx.pointEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  })
  if (existing) return { kind: 'duplicate', event: existing }

  const dateKey = istDateKey(now)
  const activity = await dbx.dailyActivity.upsert({
    where: { userId_date: { userId: input.userId, date: dateKey } },
    update: {},
    create: { userId: input.userId, date: dateKey },
  })

  const fits = clampByDailyCap(activity.pointsEarned, input.points, ctx.settings.DAILY_POINT_CAP)
  if (fits <= 0) return { kind: 'daily_cap', points: 0 }

  const event = await dbx.pointEvent.create({
    data: {
      userId: input.userId,
      points: fits,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      meta: input.meta ? JSON.stringify(input.meta) : undefined,
    },
  })
  await dbx.dailyActivity.update({
    where: { id: activity.id },
    data: { pointsEarned: { increment: fits } },
  })

  // first award of the day -> login streak (its own idempotent event)
  if (!activity.streakCounted) {
    await awardStreak(ctx, dateKey, activity.id, dbx)
  }

  return { kind: 'awarded', event, points: fits }
}

async function awardStreak(
  ctx: AwardContext,
  dateKey: string,
  activityId: string,
  dbx: DB,
): Promise<void> {
  const streakDay = await computeStreakLen(dbx, ctx.user.id, dateKey)
  const pts = streakAward(streakDay, ctx.settings.STREAK_BASE, ctx.settings.STREAK_MAX)
  // mark counted regardless, so a capped day doesn't retry every beat
  await dbx.dailyActivity.update({
    where: { id: activityId },
    data: { streakCounted: true },
  })
  if (pts <= 0) return
  const dup = await dbx.pointEvent.findUnique({
    where: { idempotencyKey: `streak:${ctx.user.id}:${dateKey}` },
  })
  if (dup) return
  const act = await dbx.dailyActivity.findUnique({ where: { id: activityId } })
  const already = act?.pointsEarned ?? 0
  const fits = clampByDailyCap(already, pts, ctx.settings.DAILY_POINT_CAP)
  if (fits <= 0) return
  await dbx.pointEvent.create({
    data: {
      userId: ctx.user.id,
      points: fits,
      reason: 'LOGIN_STREAK',
      idempotencyKey: `streak:${ctx.user.id}:${dateKey}`,
      note: `day ${streakDay}`,
    },
  })
  await dbx.dailyActivity.update({
    where: { id: activityId },
    data: { pointsEarned: { increment: fits } },
  })
}

/** Append reversal (void) rows for given event ids. One reversal per original. */
export async function voidEvents(
  adminId: string,
  userId: string,
  eventIds: string[],
  note: string,
  dbx: DB = defaultDb,
): Promise<{ voided: number; skipped: string[] }> {
  let voided = 0
  const skipped: string[] = []
  for (const id of eventIds) {
    const ev = await dbx.pointEvent.findUnique({ where: { id }, include: { reversals: true } })
    if (!ev || ev.userId !== userId) {
      skipped.push(id)
      continue
    }
    if (ev.points <= 0 || ev.reversals.length > 0) {
      skipped.push(id)
      continue
    }
    await dbx.pointEvent.create({
      data: {
        userId,
        points: -ev.points,
        reason: 'ADMIN_VOID',
        idempotencyKey: `void:${id}`,
        note: `by admin ${adminId}: ${note}`.slice(0, 300),
        reversalOfId: id,
      },
    })
    voided++
  }
  return { voided, skipped }
}

export async function lifetimePoints(userId: string, dbx: DB = defaultDb): Promise<number> {
  const agg = await dbx.pointEvent.aggregate({
    where: { userId },
    _sum: { points: true },
  })
  return agg._sum.points ?? 0
}

export interface MonthPointsRow {
  userId: string
  points: number // clamped at >= 0 per user
}

/**
 * Month points per user: sum of PointEvent.points created inside the IST
 * month, clamped per user at 0 (a fraud reversal of last month's points can
 * make this month's sum negative — it must never make other players' shares
 * bigger or create negative payouts).
 */
export async function monthPointsByUser(
  monthKey: string,
  dbx: DB = defaultDb,
): Promise<{ rows: MonthPointsRow[]; totalValidPoints: number }> {
  const { start, end } = istMonthRangeUtc(monthKey)
  const grouped = await dbx.pointEvent.groupBy({
    by: ['userId'],
    where: { createdAt: { gte: start, lt: end } },
    _sum: { points: true },
  })
  const rows = grouped
    .map((g) => ({ userId: g.userId, points: Math.max(0, g._sum.points ?? 0) }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
  const totalValidPoints = rows.reduce((s, r) => s + r.points, 0)
  return { rows, totalValidPoints }
}

/** Points a user earned inside one IST month (clamped >= 0). */
export async function userMonthPoints(
  userId: string,
  monthKey: string,
  dbx: DB = defaultDb,
): Promise<number> {
  const { start, end } = istMonthRangeUtc(monthKey)
  const agg = await dbx.pointEvent.aggregate({
    where: { userId, createdAt: { gte: start, lt: end } },
    _sum: { points: true },
  })
  return Math.max(0, agg._sum.points ?? 0)
}

/** Today's earned points + cap, for the HUD. */
export async function todayProgress(
  userId: string,
  settings: RewardSettings,
  dbx: DB = defaultDb,
): Promise<{ earned: number; cap: number; date: string }> {
  const dateKey = istDateKey()
  const act = await dbx.dailyActivity.findUnique({
    where: { userId_date: { userId, date: dateKey } },
  })
  return { earned: act?.pointsEarned ?? 0, cap: settings.DAILY_POINT_CAP, date: dateKey }
}

/** Day range export for tests. */
export { istDayRangeUtc }
