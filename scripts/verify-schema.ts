// One-off verification for the rewards schema push (Step 1).
// Checks: WAL mode, all reward tables exist, HighScore data preserved,
// reward settings table is empty (seeded later in the config step).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const journal = await db.$queryRawUnsafe(
    "PRAGMA journal_mode;",
  ) as Array<{ journal_mode: string }>
  console.log('journal_mode:', journal[0]?.journal_mode)

  const tables = await db.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
  ) as Array<{ name: string }>
  console.log('tables:', tables.map((t) => t.name).join(', '))

  const hs = await db.highScore.count()
  const top = await db.highScore.findFirst({ orderBy: { score: 'desc' } })
  console.log('highscores preserved:', hs, '| top:', top?.score ?? 'none')

  const settings = await db.rewardSetting.count()
  console.log('reward settings rows (expect 0, seeded later):', settings)
}

main()
  .catch((e) => {
    console.error('VERIFY FAILED:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
