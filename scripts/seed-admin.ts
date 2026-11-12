// Seed the first admin from CLI/env credentials. No auto-promotion path
// exists anywhere else in the app (see decisions.md ADR-005).
//
// Usage:
//   bun scripts/seed-admin.ts                       # uses ADMIN_EMAIL / ADMIN_PASSWORD env
//   bun scripts/seed-admin.ts email password        # explicit
//   bun scripts/seed-admin.ts --enable-rewards      # also flip REWARDS_ENABLED on
//
// If the email already exists AND is verified, the account is promoted to
// ADMIN (useful for taking over an existing player account). Unverified
// emails are never promoted — a new admin account is created instead with a
// printed verification link.

import { PrismaClient } from '@prisma/client'
import { hashPassword, validatePasswordPolicy } from '../src/lib/auth/password'
import { newToken, sha256 } from '../src/lib/auth/session'

const db = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  const enableRewards = args.includes('--enable-rewards')
  const positional = args.filter((a) => !a.startsWith('--'))
  const email = (positional[0] ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = positional[1] ?? process.env.ADMIN_PASSWORD ?? ''

  if (!email || !password) {
    console.error('Usage: bun scripts/seed-admin.ts [email] [password] [--enable-rewards]')
    console.error('   or: set ADMIN_EMAIL + ADMIN_PASSWORD env vars')
    process.exit(1)
  }
  const policy = validatePasswordPolicy(password)
  if (policy) {
    console.error(policy)
    process.exit(1)
  }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    if (!existing.emailVerified) {
      console.error(
        `Refusing to promote: ${email} exists but is NOT verified. ` +
          'Only verified emails can become admins. Ask the user to verify first.',
      )
      process.exit(1)
    }
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { role: 'ADMIN', passwordHash: await hashPassword(password) },
    })
    console.log(`Promoted existing verified user to ADMIN: ${updated.email}`)
  } else {
    const created = await db.user.create({
      data: {
        email,
        name: 'Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(password),
      },
    })
    const token = newToken()
    await db.emailToken.create({
      data: {
        userId: created.id,
        tokenHash: sha256(token),
        type: 'VERIFY_EMAIL',
        expiresAt: new Date(Date.now() + 72 * 3600_000),
      },
    })
    const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
    console.log(`Created admin account: ${created.email}`)
    console.log(`Verify it now: ${appUrl}/api/auth/verify-email?token=${token}`)
  }

  if (enableRewards) {
    await db.rewardSetting.upsert({
      where: { key: 'REWARDS_ENABLED' },
      update: { value: 'true' },
      create: { key: 'REWARDS_ENABLED', value: 'true' },
    })
    console.log('REWARDS_ENABLED set to true.')
  } else {
    console.log('(Rewards remain configured by RewardSettings; pass --enable-rewards to force on.)')
  }
}

main()
  .catch((e) => {
    console.error('seed-admin failed:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
