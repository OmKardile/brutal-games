// BRUTAL // ARENA — shared types

export type GamePhase = 'menu' | 'playing' | 'upgrade' | 'paused' | 'gameover'

export interface RunStats {
  score: number
  wave: number
  kills: number
  timeAlive: number
  maxCombo: number
  bossesKilled: number
  overdrivesUsed: number
  eliteKills: number
}

// Tunable player statistics, mutated by upgrades between waves.
export interface PlayerStats {
  maxHp: number
  speed: number
  damage: number
  fireRate: number // shots per second
  bulletSpeed: number
  bulletSize: number
  multishot: number
  pierce: number
  critChance: number
  lifesteal: number // hp per kill
  dashCd: number // seconds
  knockback: number
  orbs: number
}

export interface UpgradeDef {
  id: string
  name: string
  desc: string
  tag: 'OFFENSE' | 'DEFENSE' | 'MOBILITY' | 'EXOTIC'
  maxStacks: number
  apply: (s: PlayerStats) => void
}

export type GameEvent =
  | { type: 'phase'; phase: GamePhase }
  | { type: 'choices'; choices: UpgradeDef[] }
  | { type: 'gameover'; stats: RunStats }
  | { type: 'milestone'; kind: 'combo' | 'boss' | 'wave' | 'overdrive' | 'elite'; value: number }
  | { type: 'padstart' } // gamepad confirm pressed on a menu/gameover overlay
