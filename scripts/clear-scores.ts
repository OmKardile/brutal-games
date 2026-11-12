import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
db.highScore.deleteMany({}).then(r => {
  console.log('cleared test entries:', r.count)
  return db.$disconnect()
})
