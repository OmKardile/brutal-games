import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const groups = await p.highScore.groupBy({ by: ['game'], _count: true })
console.log(JSON.stringify(groups))
const total = await p.highScore.count()
console.log('total:', total)
await p.$disconnect()
