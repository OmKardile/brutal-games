import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

// SQLite WAL mode: concurrent readers while the writer works, safer crash
// recovery. WAL is persistent in the db file, but re-issuing is idempotent
// and covers freshly created databases. Must go through $queryRawUnsafe —
// the pragma returns a row, which $executeRawUnsafe rejects in SQLite.
// Fire-and-forget on first import.
void db
  .$queryRawUnsafe('PRAGMA journal_mode=WAL;')
  .catch(() => undefined)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db