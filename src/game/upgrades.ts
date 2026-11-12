// BRUTAL // ARENA — upgrade definitions (drafted between waves)

import type { PlayerStats, UpgradeDef } from './types'

export function defaultStats(): PlayerStats {
  return {
    maxHp: 100,
    speed: 265,
    damage: 13,
    fireRate: 4,
    bulletSpeed: 640,
    bulletSize: 4.2,
    multishot: 1,
    pierce: 0,
    critChance: 0.05,
    lifesteal: 0,
    dashCd: 2.6,
    knockback: 1,
    orbs: 0,
  }
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'damage',
    name: 'OVERPRESSURE ROUNDS',
    desc: '+30% bullet damage.',
    tag: 'OFFENSE',
    maxStacks: 12,
    apply: (s) => {
      s.damage *= 1.3
    },
  },
  {
    id: 'firerate',
    name: 'TRIGGER DISCIPLINE',
    desc: '+25% fire rate.',
    tag: 'OFFENSE',
    maxStacks: 10,
    apply: (s) => {
      s.fireRate = Math.min(14, s.fireRate * 1.25)
    },
  },
  {
    id: 'multishot',
    name: 'SPLIT BARREL',
    desc: '+1 projectile per shot.',
    tag: 'OFFENSE',
    maxStacks: 6,
    apply: (s) => {
      s.multishot += 1
    },
  },
  {
    id: 'pierce',
    name: 'RAIL SLUGS',
    desc: 'Bullets pierce +1 enemy, +20% bullet speed.',
    tag: 'OFFENSE',
    maxStacks: 4,
    apply: (s) => {
      s.pierce += 1
      s.bulletSpeed *= 1.2
    },
  },
  {
    id: 'bigtips',
    name: 'BIG GAME TIPS',
    desc: '+35% bullet size, +40% knockback.',
    tag: 'OFFENSE',
    maxStacks: 4,
    apply: (s) => {
      s.bulletSize *= 1.35
      s.knockback *= 1.4
    },
  },
  {
    id: 'crit',
    name: 'ADRENAL PROTOCOL',
    desc: '+12% crit chance (crits deal 2.2x damage).',
    tag: 'OFFENSE',
    maxStacks: 6,
    apply: (s) => {
      s.critChance = Math.min(0.85, s.critChance + 0.12)
    },
  },
  {
    id: 'hp',
    name: 'PLATED CORE',
    desc: '+25 max HP and restore 25 HP.',
    tag: 'DEFENSE',
    maxStacks: 12,
    apply: (s) => {
      s.maxHp += 25
    },
  },
  {
    id: 'leech',
    name: 'LEECH ROUNDS',
    desc: 'Recover 1 HP per kill.',
    tag: 'DEFENSE',
    maxStacks: 4,
    apply: (s) => {
      s.lifesteal += 1
    },
  },
  {
    id: 'speed',
    name: 'SERVO LEGS',
    desc: '+15% movement speed.',
    tag: 'MOBILITY',
    maxStacks: 6,
    apply: (s) => {
      s.speed *= 1.15
    },
  },
  {
    id: 'dash',
    name: 'PHASE DRIVE',
    desc: '-30% dash cooldown.',
    tag: 'MOBILITY',
    maxStacks: 4,
    apply: (s) => {
      s.dashCd = Math.max(0.6, s.dashCd * 0.7)
    },
  },
  {
    id: 'orbs',
    name: 'ORBITAL SAW',
    desc: '+1 sawblade orbiting you. Shreds on contact.',
    tag: 'EXOTIC',
    maxStacks: 6,
    apply: (s) => {
      s.orbs += 1
    },
  },
  {
    id: 'velocity',
    name: 'HV ACCELERATOR',
    desc: '+30% bullet speed, +10% damage.',
    tag: 'OFFENSE',
    maxStacks: 4,
    apply: (s) => {
      s.bulletSpeed *= 1.3
      s.damage *= 1.1
    },
  },
]
