// Hot backup of db/custom.db using SQLite's VACUUM INTO (safe while the app
// runs, produces a defragmented standalone copy; WAL is checkpointed into it).
//
// Usage: bun scripts/backup-db.ts [destination.db]
//   default: db/backups/custom-YYYYMMDD-HHmmss.db

import { PrismaClient } from '@prisma/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const db = new PrismaClient()

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

async function main() {
  const dest = process.argv[2] ?? `db/backups/custom-${stamp()}.db`
  mkdirSync(dirname(dest), { recursive: true })
  await db.$queryRawUnsafe(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  console.log(`backup written: ${dest}`)
}

main()
  .catch((e) => {
    console.error('backup failed:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
