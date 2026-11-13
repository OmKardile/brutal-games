// Seed a small demo leaderboard for all five games (the previous test rows
// were wiped by an earlier `prisma db push --accept-data-loss` run).
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

const demo: { name: string; score: number; wave: number; kills: number; game: string }[] = [
  // arena: wave / kills
  { name: 'AHWOO', score: 48210, wave: 11, kills: 612, game: 'arena' },
  { name: 'RAILGUN', score: 36440, wave: 9, kills: 448, game: 'arena' },
  { name: 'GRUNTMEAT', score: 21150, wave: 7, kills: 301, game: 'arena' },
  { name: 'OVERDRIVE', score: 15480, wave: 6, kills: 214, game: 'arena' },
  { name: 'PILOT-7', score: 9320, wave: 5, kills: 128, game: 'arena' },
  // stack: altitude / perfects
  { name: 'STONEHAND', score: 78, wave: 78, kills: 21, game: 'stack' },
  { name: 'PERFECTX', score: 64, wave: 64, kills: 30, game: 'stack' },
  { name: 'TOWERGIRL', score: 52, wave: 52, kills: 12, game: 'stack' },
  { name: 'BLOCKHEAD', score: 41, wave: 41, kills: 9, game: 'stack' },
  { name: 'TOPPLED', score: 33, wave: 33, kills: 4, game: 'stack' },
  // reflex: best streak / perfects
  { name: 'SNIPERBYTE', score: 2140, wave: 9, kills: 17, game: 'reflex' },
  { name: 'FRAMEPERFECT', score: 1680, wave: 7, kills: 14, game: 'reflex' },
  { name: 'TINGLE', score: 1220, wave: 5, kills: 11, game: 'reflex' },
  { name: 'SLOWHAND', score: 760, wave: 3, kills: 7, game: 'reflex' },
  { name: 'EARLYBIRD', score: 420, wave: 2, kills: 4, game: 'reflex' },
  // dodge: meters / orbs
  { name: 'NEONWRAITH', score: 1890, wave: 1420, kills: 18, game: 'dodge' },
  { name: 'GRAZE', score: 1420, wave: 1080, kills: 14, game: 'dodge' },
  { name: 'BURNER', score: 1100, wave: 860, kills: 11, game: 'dodge' },
  { name: 'WALLHUGGER', score: 780, wave: 620, kills: 7, game: 'dodge' },
  { name: 'SPLAT', score: 460, wave: 380, kills: 4, game: 'dodge' },
  // merge: highest tier / fusions
  { name: 'ATOMSMASH', score: 1560, wave: 8, kills: 44, game: 'merge' },
  { name: 'CHAINX5', score: 1130, wave: 7, kills: 36, game: 'merge' },
  { name: 'PITBOSS', score: 840, wave: 6, kills: 28, game: 'merge' },
  { name: 'FUSER', score: 520, wave: 5, kills: 19, game: 'merge' },
  { name: 'TUMBLEWEED', score: 260, wave: 4, kills: 11, game: 'merge' },
]

const existing = await p.highScore.count()
if (existing > 0) {
  console.log(`HighScore already has ${existing} rows — skipping seed.`)
} else {
  await p.highScore.createMany({ data: demo })
  console.log(`Seeded ${demo.length} demo scores across 5 games.`)
}
await p.$disconnect()
