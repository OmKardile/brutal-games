// BRUTAL // ARENA — canvas game engine, zero dependencies
// A fan-made tribute to the BRUTAL game framework (github.com/ahwootech/BRUTAL)

import { Sfx } from './audio'
import { UPGRADES, defaultStats } from './upgrades'
import type { GameEvent, GamePhase, PlayerStats, RunStats, UpgradeDef } from './types'

const ARENA_W = 1600
const ARENA_H = 900
const PLAYER_R = 14
const MAX_PARTICLES = 520
const MAX_FLOATERS = 90

type EnemyKind = 'grunt' | 'darter' | 'splitter' | 'mini' | 'spitter' | 'tank' | 'boss'

interface EnemyDef {
  hp: number
  speed: number
  r: number
  dmg: number
  color: string
  score: number
}

const ENEMY_DEF: Record<EnemyKind, EnemyDef> = {
  grunt: { hp: 32, speed: 96, r: 15, dmg: 12, color: '#ff4444', score: 10 },
  darter: { hp: 14, speed: 210, r: 10, dmg: 8, color: '#ff9f1a', score: 15 },
  splitter: { hp: 50, speed: 82, r: 19, dmg: 12, color: '#b8e62e', score: 20 },
  mini: { hp: 9, speed: 235, r: 8, dmg: 6, color: '#d6f25a', score: 5 },
  spitter: { hp: 44, speed: 74, r: 16, dmg: 10, color: '#ff5c8a', score: 25 },
  tank: { hp: 250, speed: 48, r: 33, dmg: 22, color: '#b91c1c', score: 40 },
  boss: { hp: 750, speed: 44, r: 48, dmg: 30, color: '#ff2222', score: 500 },
}

interface Enemy {
  kind: EnemyKind
  x: number
  y: number
  vx: number
  vy: number
  hp: number
  maxHp: number
  r: number
  speed: number
  dmg: number
  color: string
  score: number
  flash: number
  t: number
  orbCd: number
  spawnPop: number
  shootT: number
  burstLeft: number
  burstT: number
  minionT: number
  elite: boolean
}

interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  dmg: number
  crit: boolean
  od: boolean
  pierce: number
  life: number
  hit: Enemy[]
}

interface EBullet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  dmg: number
  life: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  drag: number
}

interface Floater {
  x: number
  y: number
  vy: number
  life: number
  text: string
  color: string
  size: number
}

interface Pickup {
  x: number
  y: number
  t: number
  life: number
}

interface SpawnMark {
  x: number
  y: number
  t: number
  kind: EnemyKind
}

interface Ambient {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  a: number
}

function rand(a = 1, b?: number): number {
  if (b === undefined) return Math.random() * a
  return a + Math.random() * (b - a)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function poly(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  sides: number,
  rot: number,
) {
  ctx.beginPath()
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/** Lighten (amt>0) or darken (amt<0) a #rrggbb color. */
function shadeColor(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = clamp((n >> 16) + amt, 0, 255)
  const g = clamp(((n >> 8) & 255) + amt, 0, 255)
  const b = clamp((n & 255) + amt, 0, 255)
  return `rgb(${r},${g},${b})`
}

/** Radial gradient that makes a flat shape read as a lit 3D model. */
function bodyGrad(ctx: CanvasRenderingContext2D, hex: string, r: number): CanvasGradient {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.3)
  g.addColorStop(0, shadeColor(hex, 70))
  g.addColorStop(0.55, hex)
  g.addColorStop(1, shadeColor(hex, -95))
  return g
}

export class BrutalGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private onEvent: (e: GameEvent) => void
  private sfx = new Sfx()

  private raf = 0
  private lastT = 0
  private destroyed = false

  private view = { w: 0, h: 0, scale: 1, ox: 0, oy: 0, dpr: 1 }
  private vignette: CanvasGradient | null = null

  phase: GamePhase = 'menu'

  // run state
  private stats: PlayerStats = defaultStats()
  private stacks: Record<string, number> = {}
  private score = 0
  private kills = 0
  private wave = 0
  private timeAlive = 0
  private combo = 0
  private comboT = 0
  private choices: UpgradeDef[] = []

  // player
  private p = {
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    vx: 0,
    vy: 0,
    hp: 100,
    iframes: 0,
    fireT: 0,
    dashT: 0,
    dashCdT: 0,
    dashX: 1,
    dashY: 0,
    aimX: 1,
    aimY: 0,
    firing: false,
  }

  // entities
  private enemies: Enemy[] = []
  private bullets: Bullet[] = []
  private ebullets: EBullet[] = []
  private particles: Particle[] = []
  private floaters: Floater[] = []
  private pickups: Pickup[] = []
  private markers: SpawnMark[] = []
  private spawnQueue: EnemyKind[] = []
  private spawnTimer = 0
  private ambient: Ambient[] = []

  // fx
  private shakeMag = 0
  private hitStop = 0
  private hurtFlash = 0
  private banner = ''
  private bannerT = 0
  private dying = false
  private deathT = 0
  private orbAngle = 0

  // overdrive / streaks / realism
  private od = 0
  private odActive = 0
  private maxCombo = 0
  private bossesKilled = 0
  private overdrivesUsed = 0
  private eliteKills = 0
  private floorImg: HTMLImageElement | null = null
  private bg: HTMLCanvasElement | null = null
  private crossPulse = 0
  private heartbeatT = 0
  private streakLevel = 0

  // input
  private keys = new Set<string>()
  private mouse = { x: 0, y: 0, down: false, seen: false }
  private touchMove = { active: false, ox: 0, oy: 0, x: 0, y: 0 }
  private touchAim = { active: false, ox: 0, oy: 0, x: 0, y: 0 }
  private isTouch = false

  constructor(canvas: HTMLCanvasElement, onEvent: (e: GameEvent) => void) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.onEvent = onEvent
    this.initAmbient()
    this.loadFloor()
    this.bindEvents()
    this.resize()
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  // ---------------------------------------------------------------- events

  private bindEvents() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('resize', this.resize)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('contextmenu', this.preventCtx)
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('contextmenu', this.preventCtx)
  }

  private preventCtx = (e: Event) => e.preventDefault()

  private onBlur = () => {
    if (this.phase === 'playing') this.togglePause()
  }

  private onVisibility = () => {
    if (document.hidden && this.phase === 'playing') this.togglePause()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) &&
      (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'upgrade')
    )
      e.preventDefault()
    this.keys.add(e.code)
    if (e.repeat) return
    if (this.phase === 'playing') {
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.tryDash()
      if (e.code === 'KeyE') this.tryOverdrive()
      if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause()
    } else if (this.phase === 'paused') {
      if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause()
    } else if (this.phase === 'gameover') {
      if (e.code === 'KeyR') this.startRun()
    } else if (this.phase === 'upgrade') {
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code)
      if (idx >= 0) {
        const c = this.choices[idx % 3]
        if (c) this.pickUpgrade(c.id)
      }
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onPointerDown = (e: PointerEvent) => {
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // synthetic / unactivated pointers cannot be captured — safe to ignore
    }
    const x = e.offsetX
    const y = e.offsetY
    if (e.pointerType === 'mouse') {
      this.mouse.seen = true
      this.mouse.x = x
      this.mouse.y = y
      if (e.button === 0) this.mouse.down = true
      return
    }
    this.isTouch = true
    // overdrive button zone (bottom-center) takes priority over sticks
    if (this.phase === 'playing') {
      const bx = this.view.w / 2
      const by = this.view.h - 72
      if ((x - bx) ** 2 + (y - by) ** 2 < 46 * 46) {
        this.tryOverdrive()
        return
      }
    }
    if (x < this.view.w * 0.5) {
      this.touchMove = { active: true, ox: x, oy: y, x, y }
    } else {
      this.touchAim = { active: true, ox: x, oy: y, x, y }
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    const x = e.offsetX
    const y = e.offsetY
    if (e.pointerType === 'mouse') {
      this.mouse.x = x
      this.mouse.y = y
      return
    }
    if (this.touchMove.active) {
      this.touchMove.x = x
      this.touchMove.y = y
    }
    if (this.touchAim.active) {
      this.touchAim.x = x
      this.touchAim.y = y
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 || e.buttons === 0) this.mouse.down = false
      return
    }
    this.touchMove.active = false
    this.touchAim.active = false
  }

  // ---------------------------------------------------------------- public

  startRun(startWave = 1) {
    this.sfx.unlock()
    this.stats = defaultStats()
    this.stacks = {}
    this.score = 0
    this.kills = 0
    this.wave = 0
    this.timeAlive = 0
    this.combo = 0
    this.comboT = 0
    this.od = 0
    this.odActive = 0
    this.maxCombo = 0
    this.bossesKilled = 0
    this.overdrivesUsed = 0
    this.eliteKills = 0
    this.streakLevel = 0
    this.enemies.length = 0
    this.bullets.length = 0
    this.ebullets.length = 0
    this.particles.length = 0
    this.floaters.length = 0
    this.pickups.length = 0
    this.markers.length = 0
    this.spawnQueue.length = 0
    this.p.x = ARENA_W / 2
    this.p.y = ARENA_H / 2
    this.p.vx = 0
    this.p.vy = 0
    this.p.hp = this.stats.maxHp
    this.p.iframes = 1
    this.p.fireT = 0
    this.p.dashT = 0
    this.p.dashCdT = 0
    this.dying = false
    this.hurtFlash = 0
    this.setPhase('playing')
    this.startWave(startWave)
  }

  pickUpgrade(id: string) {
    if (this.phase !== 'upgrade') return
    const def = UPGRADES.find((u) => u.id === id)
    if (!def) return
    def.apply(this.stats)
    this.stacks[id] = (this.stacks[id] ?? 0) + 1
    if (id === 'hp') this.p.hp = Math.min(this.p.hp + 25, this.stats.maxHp)
    this.p.hp = Math.min(this.p.hp, this.stats.maxHp)
    this.sfx.upgrade()
    this.setPhase('playing')
    this.startWave(this.wave + 1)
  }

  togglePause() {
    if (this.phase === 'playing') {
      this.setPhase('paused')
      this.sfx.ui()
    } else if (this.phase === 'paused') {
      this.setPhase('playing')
      this.sfx.ui()
    }
  }

  quitToMenu() {
    this.enemies.length = 0
    this.bullets.length = 0
    this.ebullets.length = 0
    this.particles.length = 0
    this.floaters.length = 0
    this.pickups.length = 0
    this.markers.length = 0
    this.spawnQueue.length = 0
    this.dying = false
    this.od = 0
    this.odActive = 0
    this.setPhase('menu')
  }

  setMuted(m: boolean) {
    this.sfx.muted = m
  }

  unlockAudio() {
    this.sfx.unlock()
  }

  // ---------------------------------------------------------------- helpers

  private setPhase(phase: GamePhase) {
    this.phase = phase
    this.onEvent({ type: 'phase', phase })
  }

  private emitStats() {
    const stats: RunStats = {
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      timeAlive: this.timeAlive,
      maxCombo: this.maxCombo,
      bossesKilled: this.bossesKilled,
      overdrivesUsed: this.overdrivesUsed,
      eliteKills: this.eliteKills,
    }
    this.onEvent({ type: 'gameover', stats })
  }

  private comboMult(): number {
    return Math.min(8, 1 + Math.floor(this.combo / 5))
  }

  private shake(m: number) {
    this.shakeMag = Math.min(26, this.shakeMag + m)
  }

  private floater(x: number, y: number, text: string, color: string, size = 15) {
    if (this.floaters.length >= MAX_FLOATERS) this.floaters.shift()
    this.floaters.push({ x, y, vy: -46, life: 0.9, text, color, size })
  }

  private burst(
    x: number,
    y: number,
    n: number,
    colors: string[],
    power = 180,
    size = 3,
    life = 0.5,
  ) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) return
      const a = rand(0, Math.PI * 2)
      const sp = rand(0.25, 1) * power
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.5, 1) * life,
        maxLife: life,
        size: rand(0.6, 1.3) * size,
        color: colors[Math.floor(rand(colors.length))],
        drag: 3,
      })
    }
  }

  private initAmbient() {
    this.ambient = []
    for (let i = 0; i < 46; i++) {
      this.ambient.push({
        x: rand(0, ARENA_W),
        y: rand(0, ARENA_H),
        vx: rand(-14, 14),
        vy: rand(-14, 14),
        r: rand(1, 2.6),
        a: rand(0.04, 0.16),
      })
    }
  }

  /** Loads the real-world arena floor photo and bakes it into a static layer. */
  private loadFloor() {
    const img = new Image()
    img.onload = () => {
      this.floorImg = img
      this.bakeBg()
    }
    img.onerror = () => {
      // photo unavailable — procedural grid fallback stays in place
    }
    img.src = '/images/arena_floor.jpg'
  }

  private bakeBg() {
    const img = this.floorImg
    if (!img) return
    const c = document.createElement('canvas')
    c.width = ARENA_W
    c.height = ARENA_H
    const g = c.getContext('2d')
    if (!g) return
    // real photo, cover-fit
    const s = Math.max(ARENA_W / img.width, ARENA_H / img.height)
    const dw = img.width * s
    const dh = img.height * s
    g.drawImage(img, (ARENA_W - dw) / 2, (ARENA_H - dh) / 2, dw, dh)
    // darken so entities read clearly
    g.fillStyle = 'rgba(7,7,10,0.74)'
    g.fillRect(0, 0, ARENA_W, ARENA_H)
    // faint grid keeps motion legible
    g.strokeStyle = 'rgba(255,255,255,0.028)'
    g.lineWidth = 1
    g.beginPath()
    for (let x = 0; x <= ARENA_W; x += 80) {
      g.moveTo(x, 0)
      g.lineTo(x, ARENA_H)
    }
    for (let y = 0; y <= ARENA_H; y += 80) {
      g.moveTo(0, y)
      g.lineTo(ARENA_W, y)
    }
    g.stroke()
    g.strokeStyle = 'rgba(255,50,50,0.045)'
    g.beginPath()
    for (let x = 0; x <= ARENA_W; x += 400) {
      g.moveTo(x, 0)
      g.lineTo(x, ARENA_H)
    }
    for (let y = 0; y <= ARENA_H; y += 300) {
      g.moveTo(0, y)
      g.lineTo(ARENA_W, y)
    }
    g.stroke()
    this.bg = c
  }

  // ---------------------------------------------------------------- waves

  private buildWave(n: number): EnemyKind[] {
    const queue: EnemyKind[] = []
    const isBoss = n % 5 === 0
    if (isBoss) queue.push('boss')
    let budget = isBoss ? 4 + n : 5 + Math.floor(n * 2.2)
    const pool = (
      [
        { k: 'grunt', cost: 1, min: 1 },
        { k: 'darter', cost: 1, min: 2 },
        { k: 'splitter', cost: 2, min: 3 },
        { k: 'spitter', cost: 3, min: 4 },
        { k: 'tank', cost: 5, min: 5 },
      ] as { k: EnemyKind; cost: number; min: number }[]
    ).filter((p) => n >= p.min)
    while (budget > 0) {
      const pick = pool[Math.floor(rand(pool.length))]
      if (pick.cost > budget) {
        queue.push('grunt')
        budget -= 1
      } else {
        queue.push(pick.k)
        budget -= pick.cost
      }
    }
    // shuffle
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(rand(i + 1))
      const tmp = queue[i]
      queue[i] = queue[j]
      queue[j] = tmp
    }
    return queue
  }

  private startWave(n: number) {
    this.wave = n
    this.spawnQueue = this.buildWave(n)
    this.spawnTimer = 0.9
    const isBoss = n % 5 === 0
    this.banner = isBoss ? `WAVE ${n} — BRUTE INBOUND` : `WAVE ${n}`
    this.bannerT = 2.1
    if (isBoss) this.sfx.bossStart()
    else this.sfx.waveStart()
  }

  private spawnPoint(): { x: number; y: number } {
    for (let tries = 0; tries < 24; tries++) {
      const edge = Math.floor(rand(4))
      let x = 0
      let y = 0
      if (edge === 0) {
        x = rand(50, ARENA_W - 50)
        y = 60
      } else if (edge === 1) {
        x = rand(50, ARENA_W - 50)
        y = ARENA_H - 60
      } else if (edge === 2) {
        x = 60
        y = rand(50, ARENA_H - 50)
      } else {
        x = ARENA_W - 60
        y = rand(50, ARENA_H - 50)
      }
      const dx = x - this.p.x
      const dy = y - this.p.y
      if (dx * dx + dy * dy > 240 * 240) return { x, y }
    }
    return { x: rand(60, ARENA_W - 60), y: 60 }
  }

  private makeEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const d = ENEMY_DEF[kind]
    const n = this.wave
    const hpMult = 1 + 0.18 * (n - 1)
    const spMult = 1 + Math.min(0.5, 0.025 * (n - 1))
    let hp = d.hp * hpMult
    if (kind === 'boss') hp = 750 + 520 * Math.max(0, n / 5 - 1)
    const elite = n >= 3 && kind !== 'boss' && kind !== 'mini' && Math.random() < 0.09
    if (elite) hp *= 2.2
    return {
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      r: d.r * (elite ? 1.15 : 1),
      speed: d.speed * (kind === 'boss' ? 1 : spMult) * (elite ? 1.18 : 1),
      dmg: d.dmg * (elite ? 1.25 : 1),
      color: d.color,
      score: Math.round(d.score * (elite ? 3 : 1)),
      flash: 0,
      t: rand(10),
      orbCd: 0,
      spawnPop: 0.15,
      shootT: rand(1.2, 2.4),
      burstLeft: 0,
      burstT: 0,
      minionT: 5,
      elite,
    }
  }

  private spawnMarker(kind: EnemyKind, x?: number, y?: number) {
    const pt = x !== undefined && y !== undefined ? { x, y } : this.spawnPoint()
    this.markers.push({ x: pt.x, y: pt.y, t: 0.9, kind })
  }

  // ---------------------------------------------------------------- combat

  private tryOverdrive() {
    if (this.phase !== 'playing' || this.dying) return
    if (this.od < 1 || this.odActive > 0) return
    this.od = 0
    this.odActive = 5
    this.overdrivesUsed++
    this.banner = 'OVERDRIVE ENGAGED'
    this.bannerT = 1.6
    this.shake(10)
    this.hitStop = 0.08
    this.sfx.overdrive()
    this.burst(this.p.x, this.p.y, 40, ['#ffd23b', '#ff6b35', '#ffffff'], 360, 4, 0.8)
    this.onEvent({ type: 'milestone', kind: 'overdrive', value: this.overdrivesUsed })
  }

  private tryDash() {
    if (this.p.dashCdT > 0 || this.p.dashT > 0 || this.dying) return
    const mv = this.moveInput()
    let dx = mv.x
    let dy = mv.y
    if (dx === 0 && dy === 0) {
      dx = this.p.aimX
      dy = this.p.aimY
    }
    const m = Math.hypot(dx, dy)
    if (m < 0.01) return
    this.p.dashX = dx / m
    this.p.dashY = dy / m
    this.p.dashT = 0.16
    this.p.dashCdT = this.stats.dashCd
    this.sfx.dash()
    this.burst(this.p.x, this.p.y, 10, ['#f5f5f4', '#ff6b35'], 140, 2.5, 0.35)
  }

  private fire() {
    const n = this.stats.multishot
    const base = Math.atan2(this.p.aimY, this.p.aimX)
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.11
      const a = base + off
      const crit = Math.random() < this.stats.critChance
      this.bullets.push({
        x: this.p.x + Math.cos(a) * 20,
        y: this.p.y + Math.sin(a) * 20,
        vx: Math.cos(a) * this.stats.bulletSpeed,
        vy: Math.sin(a) * this.stats.bulletSpeed,
        r: this.stats.bulletSize * (crit ? 1.35 : 1),
        dmg: this.stats.damage * (crit ? 2.2 : 1) * (this.odActive > 0 ? 2 : 1),
        crit,
        od: this.odActive > 0,
        pierce: this.stats.pierce,
        life: 1.9,
        hit: [],
      })
    }
    this.burst(
      this.p.x + this.p.aimX * 22,
      this.p.y + this.p.aimY * 22,
      3,
      ['#ffd23b', '#ff9f1a'],
      90,
      2,
      0.18,
    )
    this.shake(0.8)
    this.crossPulse = 1
    this.sfx.shoot()
  }

  private killEnemy(e: Enemy) {
    const idx = this.enemies.indexOf(e)
    if (idx >= 0) this.enemies.splice(idx, 1)
    const mult = this.comboMult()
    const gained = Math.round(e.score * mult)
    this.score += gained
    this.kills++
    this.combo++
    this.maxCombo = Math.max(this.maxCombo, this.combo)
    this.comboT = 3.5
    this.od = Math.min(1, this.od + (e.kind === 'boss' ? 0.4 : e.elite ? 0.14 : 0.07))
    // killstreak announcements
    const STREAKS: [number, string][] = [
      [10, 'KILLING SPREE'],
      [20, 'RAMPAGE'],
      [35, 'MASSACRE'],
      [55, 'UNSTOPPABLE'],
    ]
    while (this.streakLevel < STREAKS.length && this.combo >= STREAKS[this.streakLevel][0]) {
      const name = STREAKS[this.streakLevel][1]
      this.streakLevel++
      this.banner = name
      this.bannerT = 1.5
      this.sfx.streak()
      this.onEvent({ type: 'milestone', kind: 'combo', value: this.combo })
    }
    this.floater(
      e.x,
      e.y - e.r - 6,
      `+${gained}${e.elite ? ' ELITE' : ''}`,
      mult > 1 ? '#f59e0b' : '#e7e5e4',
      mult > 1 ? 17 : 14,
    )
    if (e.elite) {
      this.eliteKills++
      this.shake(3)
      this.burst(e.x, e.y, 16, ['#ffd23b', '#ffffff'], 260, 3.4, 0.6)
      this.onEvent({ type: 'milestone', kind: 'elite', value: this.eliteKills })
    }
    this.burst(e.x, e.y, 10 + Math.floor(e.r / 3), [e.color, '#ffffff', '#ff9f1a'], 160 + e.r * 4, 2 + e.r / 12, 0.55)
    if (this.stats.lifesteal > 0 && !this.dying) {
      this.p.hp = Math.min(this.stats.maxHp, this.p.hp + this.stats.lifesteal)
    }
    if (e.kind === 'splitter') {
      for (const off of [-1, 1]) {
        const m = this.makeEnemy('mini', e.x + off * 14, e.y + rand(-8, 8))
        this.enemies.push(m)
      }
    }
    if (e.kind === 'tank') {
      this.hitStop = 0.06
      this.shake(5)
    }
    if (e.kind === 'boss') {
      this.hitStop = 0.2
      this.shake(16)
      this.sfx.explode(true)
      this.burst(e.x, e.y, 60, ['#ff2222', '#ff9f1a', '#ffffff'], 420, 4.5, 0.9)
      this.pickups.push({ x: e.x, y: e.y, t: 0, life: 14 })
      this.floater(e.x, e.y - 60, 'BRUTE DOWN', '#ff2222', 24)
      this.bossesKilled++
      this.onEvent({ type: 'milestone', kind: 'boss', value: this.bossesKilled })
    } else {
      this.sfx.kill()
    }
    if (e.kind !== 'boss') {
      if (e.kind === 'tank' && Math.random() < 0.5) this.pickups.push({ x: e.x, y: e.y, t: 0, life: 12 })
      else if (Math.random() < 0.055) this.pickups.push({ x: e.x, y: e.y, t: 0, life: 12 })
    }
  }

  private damagePlayer(d: number, fromX: number, fromY: number) {
    if (this.dying) return
    this.p.hp -= d
    this.p.iframes = 0.9
    this.combo = 0
    this.streakLevel = 0
    this.hurtFlash = 0.35
    this.shake(9)
    this.sfx.hurt()
    this.floater(this.p.x, this.p.y - 26, `-${Math.round(d)}`, '#ff4444', 17)
    const dx = this.p.x - fromX
    const dy = this.p.y - fromY
    const m = Math.hypot(dx, dy) || 1
    this.p.vx += (dx / m) * 420
    this.p.vy += (dy / m) * 420
    this.burst(this.p.x, this.p.y, 14, ['#ff4444', '#ffffff'], 220, 3, 0.5)
    if (this.p.hp <= 0) this.startDeath()
  }

  private startDeath() {
    this.dying = true
    this.deathT = 1.5
    this.p.hp = 0
    this.shake(20)
    this.hitStop = 0.12
    this.sfx.explode(true)
    this.sfx.hurt()
    this.burst(this.p.x, this.p.y, 70, ['#f5f5f4', '#ff4444', '#ff9f1a'], 380, 4, 1)
  }

  // ---------------------------------------------------------------- input resolve

  private moveInput(): { x: number; y: number } {
    let x = 0
    let y = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.touchMove.active) {
      const dx = this.touchMove.x - this.touchMove.ox
      const dy = this.touchMove.y - this.touchMove.oy
      const m = Math.hypot(dx, dy)
      if (m > 8) {
        const k = Math.min(1, m / 56)
        x += (dx / m) * k
        y += (dy / m) * k
      }
    }
    const m = Math.hypot(x, y)
    if (m > 1) {
      x /= m
      y /= m
    }
    return { x, y }
  }

  private nearestEnemy(): Enemy | null {
    let best: Enemy | null = null
    let bd = Infinity
    for (const e of this.enemies) {
      const d = (e.x - this.p.x) ** 2 + (e.y - this.p.y) ** 2
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }

  private resolveAim(): { firing: boolean } {
    // touch aim stick overrides
    if (this.touchAim.active) {
      const dx = this.touchAim.x - this.touchAim.ox
      const dy = this.touchAim.y - this.touchAim.oy
      const m = Math.hypot(dx, dy)
      if (m > 14) {
        this.p.aimX = dx / m
        this.p.aimY = dy / m
        return { firing: m > 24 }
      }
    }
    // touch with no aim stick: auto-aim + auto-fire
    if (this.isTouch && !this.mouse.seen) {
      const t = this.nearestEnemy()
      if (t) {
        const dx = t.x - this.p.x
        const dy = t.y - this.p.y
        const m = Math.hypot(dx, dy) || 1
        this.p.aimX = dx / m
        this.p.aimY = dy / m
        return { firing: true }
      }
      return { firing: false }
    }
    // mouse aim
    const w = this.screenToWorld(this.mouse.x, this.mouse.y)
    const dx = w.x - this.p.x
    const dy = w.y - this.p.y
    const m = Math.hypot(dx, dy)
    if (m > 4) {
      this.p.aimX = dx / m
      this.p.aimY = dy / m
    }
    return { firing: this.mouse.down }
  }

  // ---------------------------------------------------------------- update

  private loop = (t: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    const realDt = Math.min(0.05, Math.max(0.0001, (t - this.lastT) / 1000))
    this.lastT = t

    let dt = realDt
    if (this.hitStop > 0) {
      this.hitStop -= realDt
      dt *= 0.12
    }
    if (this.dying) dt *= 0.3
    if (this.phase !== 'playing') dt = 0

    // ambient always drifts in menu
    if (this.phase === 'menu') this.updateAmbient(realDt)

    // fx decay in real time
    this.shakeMag *= Math.exp(-5.5 * realDt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 1.4)
    if (this.bannerT > 0) this.bannerT -= realDt

    if (this.odActive > 0) this.odActive = Math.max(0, this.odActive - realDt)
    // low-hp heartbeat tension
    if (this.phase === 'playing' && !this.dying && this.p.hp / this.stats.maxHp < 0.3) {
      this.heartbeatT -= realDt
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 0.85
        this.sfx.heartbeat()
      }
    }
    if (this.phase === 'playing') {
      this.timeAlive += realDt
      const worldDt = dt * (this.odActive > 0 ? 0.55 : 1)
      this.updatePlayer(dt)
      this.updateSpawning(worldDt)
      this.updateEnemies(worldDt)
      this.updateBullets(dt)
      this.updateEBullets(worldDt)
      this.updateOrbs(dt)
      this.updatePickups(dt)
      if (this.comboT > 0) {
        this.comboT -= dt
        if (this.comboT <= 0) this.combo = 0
      }
      this.checkWaveClear()
    }
    this.updateParticles(this.phase === 'playing' || this.dying ? dt : this.phase === 'menu' ? realDt : 0)
    this.updateFloaters(this.phase === 'playing' || this.dying ? dt : 0)

    if (this.dying) {
      this.deathT -= realDt
      if (this.deathT <= 0) {
        this.dying = false
        this.emitStats()
        this.setPhase('gameover')
      }
    }

    this.render()
  }

  private updateAmbient(dt: number) {
    for (const a of this.ambient) {
      a.x += a.vx * dt
      a.y += a.vy * dt
      if (a.x < 0) a.x += ARENA_W
      if (a.x > ARENA_W) a.x -= ARENA_W
      if (a.y < 0) a.y += ARENA_H
      if (a.y > ARENA_H) a.y -= ARENA_H
    }
  }

  private updatePlayer(dt: number) {
    if (this.dying) return
    const mv = this.moveInput()
    const { firing } = this.resolveAim()

    this.p.iframes -= dt
    this.p.dashCdT = Math.max(0, this.p.dashCdT - dt)
    this.p.dashT -= dt

    const sp = this.stats.speed * (this.p.dashT > 0 ? 4.2 : 1)
    let tvx = mv.x * sp
    let tvy = mv.y * sp
    if (this.p.dashT > 0) {
      tvx = this.p.dashX * sp
      tvy = this.p.dashY * sp
      if (this.particles.length < MAX_PARTICLES - 4) {
        this.particles.push({
          x: this.p.x,
          y: this.p.y,
          vx: 0,
          vy: 0,
          life: 0.3,
          maxLife: 0.3,
          size: 9,
          color: 'rgba(245,245,244,0.5)',
          drag: 0,
        })
      }
    }
    const k = 1 - Math.exp(-18 * dt)
    this.p.vx += (tvx - this.p.vx) * k
    this.p.vy += (tvy - this.p.vy) * k
    this.p.x = clamp(this.p.x + this.p.vx * dt, PLAYER_R + 6, ARENA_W - PLAYER_R - 6)
    this.p.y = clamp(this.p.y + this.p.vy * dt, PLAYER_R + 6, ARENA_H - PLAYER_R - 6)

    this.p.fireT -= dt
    if (firing && this.p.fireT <= 0) {
      this.p.fireT = 1 / (this.stats.fireRate * (this.odActive > 0 ? 2 : 1))
      this.fire()
    }
    // overdrive trail
    if (this.odActive > 0 && this.particles.length < MAX_PARTICLES - 3) {
      this.particles.push({
        x: this.p.x + rand(-8, 8),
        y: this.p.y + rand(-8, 8),
        vx: 0,
        vy: 0,
        life: 0.35,
        maxLife: 0.35,
        size: rand(3, 6),
        color: 'rgba(255,210,59,0.5)',
        drag: 0,
      })
    }
  }

  private updateSpawning(dt: number) {
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        const count = Math.random() < 0.35 ? 2 : 1
        for (let i = 0; i < count && this.spawnQueue.length > 0; i++) {
          const kind = this.spawnQueue.shift()
          if (kind) this.spawnMarker(kind)
        }
        this.spawnTimer = clamp(1.5 - this.wave * 0.045, 0.45, 1.5) * rand(0.7, 1.25)
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i]
      m.t -= dt
      if (m.t <= 0) {
        this.markers.splice(i, 1)
        this.enemies.push(this.makeEnemy(m.kind, m.x, m.y))
        this.burst(m.x, m.y, 6, ['#ff4444', '#7f1d1d'], 120, 2.4, 0.35)
        if (m.kind === 'boss') {
          this.shake(10)
        }
      }
    }
  }

  private updateEnemies(dt: number) {
    const px = this.p.x
    const py = this.p.y
    for (const e of this.enemies) {
      e.t += dt
      e.flash = Math.max(0, e.flash - dt)
      e.orbCd = Math.max(0, e.orbCd - dt)
      e.spawnPop = Math.max(0, e.spawnPop - dt)
      const dx = px - e.x
      const dy = py - e.y
      const dist = Math.hypot(dx, dy) || 1
      const nx = dx / dist
      const ny = dy / dist
      let mvx = 0
      let mvy = 0
      if (e.kind === 'grunt' || e.kind === 'mini' || e.kind === 'tank' || e.kind === 'splitter') {
        mvx = nx
        mvy = ny
      } else if (e.kind === 'darter') {
        const wob = Math.sin(e.t * 6) * 0.55
        const ca = Math.cos(wob)
        const sa = Math.sin(wob)
        mvx = nx * ca - ny * sa
        mvy = nx * sa + ny * ca
      } else if (e.kind === 'spitter') {
        e.shootT -= dt
        if (e.burstLeft > 0) {
          e.burstT -= dt
          if (e.burstT <= 0) {
            e.burstLeft--
            e.burstT = 0.15
            const sp = 250
            this.ebullets.push({
              x: e.x + nx * (e.r + 6),
              y: e.y + ny * (e.r + 6),
              vx: nx * sp,
              vy: ny * sp,
              r: 5,
              dmg: 10,
              life: 6,
            })
            this.sfx.hit()
          }
        }
        if (e.shootT <= 0 && dist < 680) {
          e.shootT = rand(2.1, 2.9)
          e.burstLeft = 3
          e.burstT = 0
        }
        if (dist < 280) {
          mvx = -nx
          mvy = -ny
        } else if (dist > 370) {
          mvx = nx
          mvy = ny
        } else {
          const strafe = Math.sin(e.t * 1.6)
          mvx = -ny * strafe
          mvy = nx * strafe
        }
      } else if (e.kind === 'boss') {
        const enraged = e.hp < e.maxHp * 0.3
        const spd = enraged ? e.speed * 1.6 : e.speed
        mvx = nx
        mvy = ny
        e.burstT -= dt
        if (e.burstT <= 0) {
          e.burstT = enraged ? 3.1 : 4.4
          const n = enraged ? 26 : 18
          const base = rand(Math.PI * 2)
          for (let i = 0; i < n; i++) {
            const a = base + (i / n) * Math.PI * 2
            const sp = 200
            this.ebullets.push({
              x: e.x + Math.cos(a) * (e.r + 8),
              y: e.y + Math.sin(a) * (e.r + 8),
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              r: 6,
              dmg: 12,
              life: 7,
            })
          }
          this.shake(5)
          this.sfx.explode(false)
        }
        e.minionT -= dt
        if (e.minionT <= 0) {
          e.minionT = 8.5
          for (let i = 0; i < 3; i++) {
            this.spawnMarker(
              'grunt',
              clamp(e.x + rand(-140, 140), 60, ARENA_W - 60),
              clamp(e.y + rand(-140, 140), 60, ARENA_H - 60),
            )
          }
        }
        e.vx = mvx * spd
        e.vy = mvy * spd
        e.x += e.vx * dt
        e.y += e.vy * dt
      }
      if (e.kind !== 'boss') {
        e.vx = mvx * e.speed
        e.vy = mvy * e.speed
        e.x += e.vx * dt
        e.y += e.vy * dt
      }
      e.x = clamp(e.x, e.r, ARENA_W - e.r)
      e.y = clamp(e.y, e.r, ARENA_H - e.r)
    }

    // separation
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i]
        const b = this.enemies[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        const min = a.r + b.r
        if (d > 0.001 && d < min) {
          const push = ((min - d) / d) * 0.4
          const aw = b.r / (a.r + b.r)
          const bw = a.r / (a.r + b.r)
          a.x -= dx * push * aw
          a.y -= dy * push * aw
          b.x += dx * push * bw
          b.y += dy * push * bw
        }
      }
    }

    // contact with player
    if (!this.dying && this.p.iframes <= 0 && this.p.dashT <= 0) {
      for (const e of this.enemies) {
        const dx = this.p.x - e.x
        const dy = this.p.y - e.y
        const d = Math.hypot(dx, dy)
        if (d < e.r + PLAYER_R) {
          this.damagePlayer(e.dmg, e.x, e.y)
          const m = Math.hypot(dx, dy) || 1
          e.vx = -(dx / m) * 200
          e.vy = -(dy / m) * 200
          break
        }
      }
    }
  }

  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (
        b.life <= 0 ||
        b.x < -20 ||
        b.x > ARENA_W + 20 ||
        b.y < -20 ||
        b.y > ARENA_H + 20
      ) {
        this.bullets.splice(i, 1)
        continue
      }
      for (const e of this.enemies) {
        if (b.hit.includes(e)) continue
        const dx = e.x - b.x
        const dy = e.y - b.y
        if (dx * dx + dy * dy < (e.r + b.r) ** 2) {
          e.hp -= b.dmg
          e.flash = 0.09
          this.floater(
            e.x + rand(-8, 8),
            e.y - e.r - 4,
            `${Math.round(b.dmg)}`,
            b.crit ? '#f59e0b' : '#e7e5e4',
            b.crit ? 18 : 13,
          )
          this.burst(b.x, b.y, 4, ['#ffd23b', '#ffffff'], 130, 2, 0.25)
          this.sfx.hit()
          // knockback
          const m = Math.hypot(b.vx, b.vy) || 1
          const kb = 110 * this.stats.knockback * (e.kind === 'tank' ? 0.25 : e.kind === 'boss' ? 0.06 : 1)
          e.x += (b.vx / m) * kb * dt * 8
          e.y += (b.vy / m) * kb * dt * 8
          if (e.hp <= 0) {
            this.killEnemy(e)
          }
          b.hit.push(e)
          if (b.pierce > 0) {
            b.pierce--
          } else {
            this.bullets.splice(i, 1)
          }
          break
        }
      }
    }
  }

  private updateEBullets(dt: number) {
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i]
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (
        b.life <= 0 ||
        b.x < -20 ||
        b.x > ARENA_W + 20 ||
        b.y < -20 ||
        b.y > ARENA_H + 20
      ) {
        this.ebullets.splice(i, 1)
        continue
      }
      if (!this.dying && this.p.iframes <= 0 && this.p.dashT <= 0) {
        const dx = this.p.x - b.x
        const dy = this.p.y - b.y
        if (dx * dx + dy * dy < (PLAYER_R + b.r) ** 2) {
          this.damagePlayer(b.dmg, b.x, b.y)
          this.ebullets.splice(i, 1)
        }
      }
    }
  }

  private updateOrbs(dt: number) {
    if (this.stats.orbs <= 0) return
    this.orbAngle += dt * 3.1
    const R = 74
    for (let i = 0; i < this.stats.orbs; i++) {
      const a = this.orbAngle + (i / this.stats.orbs) * Math.PI * 2
      const ox = this.p.x + Math.cos(a) * R
      const oy = this.p.y + Math.sin(a) * R
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j]
        if (!e || e.orbCd > 0) continue
        const dx = e.x - ox
        const dy = e.y - oy
        if (dx * dx + dy * dy < (e.r + 11) ** 2) {
          e.orbCd = 0.35
          e.hp -= this.stats.damage * 0.9
          e.flash = 0.09
          this.floater(e.x, e.y - e.r - 4, `${Math.round(this.stats.damage * 0.9)}`, '#e7e5e4', 12)
          this.burst(ox, oy, 3, ['#ffffff', '#ff6b35'], 120, 2, 0.2)
          this.sfx.hit()
          if (e.hp <= 0) this.killEnemy(e)
        }
      }
    }
  }

  private updatePickups(dt: number) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]
      pk.t += dt
      pk.life -= dt
      if (pk.life <= 0) {
        this.pickups.splice(i, 1)
        continue
      }
      if (!this.dying) {
        const dx = this.p.x - pk.x
        const dy = this.p.y - pk.y
        if (dx * dx + dy * dy < 30 * 30) {
          this.pickups.splice(i, 1)
          this.p.hp = Math.min(this.stats.maxHp, this.p.hp + 25)
          this.sfx.pickup()
          this.floater(this.p.x, this.p.y - 30, '+25 HP', '#6dff8a', 16)
          this.burst(pk.x, pk.y, 8, ['#6dff8a', '#ffffff'], 140, 2.4, 0.4)
        }
      }
    }
  }

  private checkWaveClear() {
    if (this.dying) return
    if (this.spawnQueue.length > 0 || this.markers.length > 0 || this.enemies.length > 0) return
    const bonus = 40 * this.wave
    this.score += bonus
    this.floater(this.p.x, this.p.y - 50, `WAVE CLEAR +${bonus}`, '#6dff8a', 20)
    this.sfx.upgrade()
    // draft 3 upgrade choices
    const avail = UPGRADES.filter((u) => (this.stacks[u.id] ?? 0) < u.maxStacks)
    const shuffled = [...avail]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand(i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    this.choices = shuffled.slice(0, 3)
    if (this.choices.length === 0) {
      // everything maxed: skip straight to next wave
      this.startWave(this.wave + 1)
      return
    }
    this.onEvent({ type: 'choices', choices: this.choices })
    this.setPhase('upgrade')
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i]
      q.life -= dt
      if (q.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      q.x += q.vx * dt
      q.y += q.vy * dt
      if (q.drag > 0) {
        const f = Math.exp(-q.drag * dt)
        q.vx *= f
        q.vy *= f
      }
    }
  }

  private updateFloaters(dt: number) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]
      f.life -= dt
      if (f.life <= 0) {
        this.floaters.splice(i, 1)
        continue
      }
      f.y += f.vy * dt
      f.vy *= Math.exp(-2 * dt)
    }
  }

  // ---------------------------------------------------------------- view

  resize = () => {
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, rect.width)
    const h = Math.max(1, rect.height)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.view.w = w
    this.view.h = h
    this.view.dpr = dpr
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    const scale = Math.min(w / ARENA_W, h / ARENA_H)
    this.view.scale = scale
    this.view.ox = (w - ARENA_W * scale) / 2
    this.view.oy = (h - ARENA_H * scale) / 2
    const g = this.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.52)')
    this.vignette = g
    if (!this.mouse.seen) {
      this.mouse.x = w / 2
      this.mouse.y = h / 2
    }
  }

  private camX(): number {
    return (this.p.x - ARENA_W / 2) * 0.03 + rand(-1, 1) * this.shakeMag
  }

  private camY(): number {
    return (this.p.y - ARENA_H / 2) * 0.03 + rand(-1, 1) * this.shakeMag
  }

  private applyWorld() {
    const { dpr, scale, ox, oy } = this.view
    const cx = this.camX()
    const cy = this.camY()
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.translate(ox - cx * scale, oy - cy * scale)
    this.ctx.scale(scale, scale)
  }

  private applyScreen() {
    const { dpr } = this.view
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const { scale, ox, oy } = this.view
    // world -> screen: sx = ox + scale * (wx - camX)  =>  inverse below
    return {
      x: (sx - ox) / scale + this.camX(),
      y: (sy - oy) / scale + this.camY(),
    }
  }

  // ---------------------------------------------------------------- render

  private render() {
    const ctx = this.ctx
    const { w, h } = this.view
    this.applyScreen()
    ctx.fillStyle = '#070709'
    ctx.fillRect(0, 0, w, h)

    this.applyWorld()
    this.drawArena()
    this.drawMarkers()
    this.drawPickups()
    this.drawParticles()
    this.drawEBullets()
    this.drawEnemies()
    this.drawPlayer()
    this.drawLaser()
    this.drawBullets()
    this.drawOrbs()
    this.drawFloaters()

    this.applyScreen()
    if (this.vignette) {
      ctx.fillStyle = this.vignette
      ctx.fillRect(0, 0, w, h)
    }
    this.drawLowHp()
    if (this.odActive > 0) {
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.3,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.75,
      )
      g.addColorStop(0, 'rgba(255,210,59,0)')
      g.addColorStop(1, `rgba(255,160,30,${0.15 + 0.05 * Math.sin(performance.now() / 120)})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,32,32,${this.hurtFlash * 0.5})`
      ctx.fillRect(0, 0, w, h)
    }
    if (this.phase !== 'menu') this.drawHud()
    this.drawBanner()
    this.drawSticks()
    this.drawTouchUlt()
    this.drawCrosshair()
  }

  private drawArena() {
    const ctx = this.ctx
    if (this.bg) {
      ctx.drawImage(this.bg, 0, 0)
    } else {
      ctx.fillStyle = '#0b0b0e'
      ctx.fillRect(0, 0, ARENA_W, ARENA_H)
      // minor grid
      ctx.strokeStyle = 'rgba(255,255,255,0.032)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= ARENA_W; x += 80) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, ARENA_H)
      }
      for (let y = 0; y <= ARENA_H; y += 80) {
        ctx.moveTo(0, y)
        ctx.lineTo(ARENA_W, y)
      }
      ctx.stroke()
      // major grid
      ctx.strokeStyle = 'rgba(255,50,50,0.06)'
      ctx.beginPath()
      for (let x = 0; x <= ARENA_W; x += 400) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, ARENA_H)
      }
      for (let y = 0; y <= ARENA_H; y += 300) {
        ctx.moveTo(0, y)
        ctx.lineTo(ARENA_W, y)
      }
      ctx.stroke()
    }
    // border
    ctx.save()
    ctx.strokeStyle = 'rgba(239,68,68,0.55)'
    ctx.lineWidth = 3
    ctx.shadowColor = 'rgba(239,68,68,0.6)'
    ctx.shadowBlur = 22
    ctx.strokeRect(1.5, 1.5, ARENA_W - 3, ARENA_H - 3)
    ctx.restore()
    // corner accents
    ctx.strokeStyle = 'rgba(239,68,68,0.9)'
    ctx.lineWidth = 4
    const L = 42
    const corners: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [ARENA_W, 0, -1, 1],
      [0, ARENA_H, 1, -1],
      [ARENA_W, ARENA_H, -1, -1],
    ]
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath()
      ctx.moveTo(cx + sx * 4, cy + sy * (4 + L))
      ctx.lineTo(cx + sx * 4, cy + sy * 4)
      ctx.lineTo(cx + sx * (4 + L), cy + sy * 4)
      ctx.stroke()
    }
    // ambient dust (menu)
    if (this.phase === 'menu') {
      for (const a of this.ambient) {
        ctx.fillStyle = `rgba(255,80,80,${a.a})`
        ctx.beginPath()
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  private drawMarkers() {
    const ctx = this.ctx
    for (const m of this.markers) {
      const k = 1 - m.t / 0.9
      const r = 26 * (1 - k * 0.6)
      ctx.save()
      ctx.translate(m.x, m.y)
      ctx.rotate(m.t * 3)
      ctx.strokeStyle = `rgba(255,68,68,${0.35 + 0.55 * k})`
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(-r - 5, 0)
      ctx.lineTo(-r + 5, 0)
      ctx.moveTo(r - 5, 0)
      ctx.lineTo(r + 5, 0)
      ctx.moveTo(0, -r - 5)
      ctx.lineTo(0, -r + 5)
      ctx.moveTo(0, r - 5)
      ctx.lineTo(0, r + 5)
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawPickups() {
    const ctx = this.ctx
    for (const pk of this.pickups) {
      const blink = pk.life < 3 && Math.floor(pk.life * 6) % 2 === 0
      if (blink) continue
      const bob = Math.sin(pk.t * 3.4) * 4
      ctx.save()
      ctx.translate(pk.x, pk.y + bob)
      ctx.fillStyle = '#12121a'
      ctx.strokeStyle = '#6dff8a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(-11, -11, 22, 22, 4)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#6dff8a'
      ctx.fillRect(-2.5, -7, 5, 14)
      ctx.fillRect(-7, -2.5, 14, 5)
      ctx.restore()
    }
  }

  private drawParticles() {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const q of this.particles) {
      const a = clamp(q.life / q.maxLife, 0, 1)
      ctx.globalAlpha = a
      ctx.fillStyle = q.color
      ctx.beginPath()
      ctx.arc(q.x, q.y, q.size * (0.5 + a * 0.5), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawEBullets() {
    const ctx = this.ctx
    for (const b of this.ebullets) {
      ctx.save()
      ctx.fillStyle = '#ff4d6d'
      ctx.shadowColor = '#ff4d6d'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private groundShadow(x: number, y: number, r: number) {
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.beginPath()
    ctx.ellipse(x, y + r * 0.95, r * 0.85, r * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawEnemies() {
    const ctx = this.ctx
    for (const e of this.enemies) {
      const pop = e.spawnPop > 0 ? 1 - e.spawnPop / 0.15 : 1
      const scale = 0.4 + 0.6 * pop
      // ground shadow anchors the model to the floor
      this.groundShadow(e.x, e.y, e.r)
      ctx.save()
      ctx.translate(e.x, e.y)
      ctx.scale(scale, scale)
      const c = e.color
      if (e.elite) {
        const pulse = 0.75 + 0.25 * Math.sin(e.t * 6)
        ctx.save()
        ctx.strokeStyle = `rgba(255,210,59,${0.55 * pulse})`
        ctx.lineWidth = 3
        ctx.shadowColor = '#ffd23b'
        ctx.shadowBlur = 16 * pulse
        ctx.beginPath()
        ctx.arc(0, 0, e.r * 1.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
      switch (e.kind) {
        case 'grunt': {
          ctx.rotate(Math.PI / 4 + Math.sin(e.t * 2) * 0.2)
          const gSquare = ctx.createLinearGradient(-e.r, -e.r, e.r, e.r)
          gSquare.addColorStop(0, shadeColor(c, 60))
          gSquare.addColorStop(0.55, c)
          gSquare.addColorStop(1, shadeColor(c, -80))
          ctx.fillStyle = gSquare
          ctx.fillRect(-e.r * 0.85, -e.r * 0.85, e.r * 1.7, e.r * 1.7)
          ctx.strokeStyle = shadeColor(c, 90)
          ctx.lineWidth = 1.5
          ctx.strokeRect(-e.r * 0.85, -e.r * 0.85, e.r * 1.7, e.r * 1.7)
          ctx.fillStyle = 'rgba(0,0,0,0.38)'
          ctx.fillRect(-e.r * 0.4, -e.r * 0.4, e.r * 0.8, e.r * 0.8)
          // glowing eye slit
          ctx.fillStyle = '#ffe8e8'
          ctx.fillRect(-e.r * 0.3, -e.r * 0.09, e.r * 0.6, e.r * 0.18)
          break
        }
        case 'darter': {
          const a = Math.atan2(e.vy, e.vx)
          ctx.rotate(a)
          const gDart = ctx.createLinearGradient(-e.r, 0, e.r * 1.4, 0)
          gDart.addColorStop(0, shadeColor(c, -70))
          gDart.addColorStop(0.7, c)
          gDart.addColorStop(1, shadeColor(c, 80))
          ctx.fillStyle = gDart
          ctx.beginPath()
          ctx.moveTo(e.r * 1.4, 0)
          ctx.lineTo(-e.r, e.r * 0.8)
          ctx.lineTo(-e.r * 0.4, 0)
          ctx.lineTo(-e.r, -e.r * 0.8)
          ctx.closePath()
          ctx.fill()
          ctx.strokeStyle = shadeColor(c, 100)
          ctx.lineWidth = 1
          ctx.stroke()
          break
        }
        case 'splitter': {
          const pulse = 1 + Math.sin(e.t * 5) * 0.08
          const gOrb = bodyGrad(ctx, c, e.r * pulse)
          ctx.fillStyle = gOrb
          ctx.beginPath()
          ctx.arc(0, 0, e.r * pulse, 0, Math.PI * 2)
          ctx.fill()
          const gCore = ctx.createRadialGradient(0, 0, 0, 0, 0, e.r * 0.55 * pulse)
          gCore.addColorStop(0, 'rgba(0,0,0,0.55)')
          gCore.addColorStop(1, 'rgba(0,0,0,0.05)')
          ctx.fillStyle = gCore
          ctx.beginPath()
          ctx.arc(0, 0, e.r * 0.55 * pulse, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = shadeColor(c, 90)
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(0, 0, e.r * 0.55 * pulse, 0, Math.PI * 2)
          ctx.stroke()
          // specular highlight
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.beginPath()
          ctx.ellipse(-e.r * 0.35, -e.r * 0.4, e.r * 0.22, e.r * 0.13, -0.6, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'mini': {
          ctx.fillStyle = bodyGrad(ctx, c, e.r)
          ctx.beginPath()
          ctx.arc(0, 0, e.r, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'spitter': {
          ctx.save()
          ctx.rotate(e.t * 1.4)
          ctx.fillStyle = bodyGrad(ctx, c, e.r)
          poly(ctx, 0, 0, e.r, 5, 0)
          ctx.fill()
          ctx.strokeStyle = shadeColor(c, 80)
          ctx.lineWidth = 1.5
          poly(ctx, 0, 0, e.r, 5, 0)
          ctx.stroke()
          ctx.restore()
          const pa = Math.atan2(this.p.y - e.y, this.p.x - e.x)
          const eyeG = ctx.createRadialGradient(
            Math.cos(pa) * e.r * 0.4,
            Math.sin(pa) * e.r * 0.4,
            0.5,
            Math.cos(pa) * e.r * 0.4,
            Math.sin(pa) * e.r * 0.4,
            4,
          )
          eyeG.addColorStop(0, '#ffffff')
          eyeG.addColorStop(1, '#fca5a5')
          ctx.fillStyle = eyeG
          ctx.beginPath()
          ctx.arc(Math.cos(pa) * e.r * 0.4, Math.sin(pa) * e.r * 0.4, 3.2, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'tank': {
          ctx.save()
          ctx.rotate(e.t * 0.5)
          ctx.fillStyle = bodyGrad(ctx, c, e.r)
          poly(ctx, 0, 0, e.r, 6, 0)
          ctx.fill()
          // armor plating rings
          ctx.strokeStyle = shadeColor(c, -110)
          ctx.lineWidth = 5
          poly(ctx, 0, 0, e.r * 0.62, 6, 0)
          ctx.stroke()
          ctx.strokeStyle = shadeColor(c, 60)
          ctx.lineWidth = 1.2
          poly(ctx, 0, 0, e.r * 0.95, 6, 0)
          ctx.stroke()
          // bolts
          ctx.fillStyle = shadeColor(c, 120)
          for (let i = 0; i < 6; i++) {
            const ba = (i / 6) * Math.PI * 2
            ctx.beginPath()
            ctx.arc(Math.cos(ba) * e.r * 0.79, Math.sin(ba) * e.r * 0.79, 2.2, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = 'rgba(0,0,0,0.55)'
          poly(ctx, 0, 0, e.r * 0.25, 6, 0)
          ctx.fill()
          ctx.restore()
          break
        }
        case 'boss': {
          const enraged = e.hp < e.maxHp * 0.3
          ctx.save()
          ctx.rotate(e.t * 0.6)
          const spikes = 12
          ctx.beginPath()
          for (let i = 0; i < spikes * 2; i++) {
            const a = (i / (spikes * 2)) * Math.PI * 2
            const rr = i % 2 === 0 ? e.r : e.r * 0.6
            const px = Math.cos(a) * rr
            const py = Math.sin(a) * rr
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
          ctx.shadowColor = '#ff2222'
          ctx.shadowBlur = 24
          ctx.fillStyle = enraged ? '#ff5c5c' : c
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.strokeStyle = enraged ? '#ffffff' : shadeColor(c, 90)
          ctx.lineWidth = 2.5
          ctx.stroke()
          ctx.restore()
          // molten core
          const coreG = ctx.createRadialGradient(0, 0, 0, 0, 0, e.r * 0.45)
          coreG.addColorStop(0, '#1a0505')
          coreG.addColorStop(0.7, '#300808')
          coreG.addColorStop(1, '#1a0505')
          ctx.fillStyle = coreG
          ctx.beginPath()
          ctx.arc(0, 0, e.r * 0.42, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = enraged ? '#ffffff' : '#ff6b35'
          ctx.shadowColor = enraged ? '#ffffff' : '#ff6b35'
          ctx.shadowBlur = 18
          ctx.beginPath()
          ctx.arc(0, 0, e.r * 0.2 * (1 + Math.sin(e.t * 6) * 0.2), 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
          break
        }
      }
      if (e.flash > 0) {
        ctx.globalAlpha = clamp(e.flash * 8, 0, 0.85)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(0, 0, e.r * 1.05, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.restore()
      // hp bar for chunky enemies
      if ((e.kind === 'tank' || e.kind === 'boss' || e.kind === 'spitter' || e.elite) && e.hp < e.maxHp) {
        const wBar = e.r * 2.2
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(e.x - wBar / 2, e.y - e.r - 14, wBar, 5)
        ctx.fillStyle = e.elite ? '#ffd23b' : '#ef4444'
        ctx.fillRect(e.x - wBar / 2, e.y - e.r - 14, wBar * clamp(e.hp / e.maxHp, 0, 1), 5)
      }
    }
  }

  private drawPlayer() {
    if (this.dying) return
    const ctx = this.ctx
    const p = this.p
    this.groundShadow(p.x, p.y, PLAYER_R)
    ctx.save()
    ctx.translate(p.x, p.y)
    // overdrive aura
    if (this.odActive > 0) {
      const t = performance.now() / 1000
      ctx.save()
      ctx.rotate(t * 2.4)
      ctx.strokeStyle = 'rgba(255,210,59,0.8)'
      ctx.lineWidth = 2.5
      ctx.setLineDash([10, 7])
      ctx.beginPath()
      ctx.arc(0, 0, 27 + Math.sin(t * 8) * 2.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
      // charged glow
      ctx.shadowColor = '#ffd23b'
      ctx.shadowBlur = 26
    }
    if (p.iframes > 0) {
      ctx.globalAlpha = 0.45 + 0.35 * Math.sin(p.iframes * 42)
    }
    const a = Math.atan2(p.aimY, p.aimX)
    ctx.rotate(a)
    // engine flame (layered, animated)
    const sp = Math.hypot(p.vx, p.vy)
    if (sp > 30) {
      const fl = clamp(sp * 0.05, 6, 30)
      const fg = ctx.createLinearGradient(-12, 0, -12 - fl, 0)
      fg.addColorStop(0, 'rgba(255,210,59,0.95)')
      fg.addColorStop(0.5, 'rgba(255,107,53,0.75)')
      fg.addColorStop(1, 'rgba(255,60,30,0)')
      ctx.fillStyle = fg
      ctx.beginPath()
      ctx.moveTo(-12, -4.5)
      ctx.lineTo(-12 - fl * (1 + Math.sin(performance.now() / 30) * 0.18), 0)
      ctx.lineTo(-12, 4.5)
      ctx.closePath()
      ctx.fill()
    }
    // hull — brushed metal
    const hull = ctx.createLinearGradient(0, -14, 0, 14)
    hull.addColorStop(0, '#ffffff')
    hull.addColorStop(0.5, '#e7e5e4')
    hull.addColorStop(1, '#a8a29e')
    ctx.fillStyle = hull
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(19, 0)
    ctx.lineTo(-13, -13)
    ctx.lineTo(-6, 0)
    ctx.lineTo(-13, 13)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    // wing plating lines
    ctx.strokeStyle = 'rgba(120,113,108,0.85)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(10, -4)
    ctx.lineTo(-8, -8)
    ctx.moveTo(10, 4)
    ctx.lineTo(-8, 8)
    ctx.stroke()
    // twin cannons
    ctx.fillStyle = '#78716c'
    ctx.fillRect(8, -6.5, 14, 2.6)
    ctx.fillRect(8, 3.9, 14, 2.6)
    ctx.fillStyle = '#57534e'
    ctx.fillRect(19, -6.5, 3, 2.6)
    ctx.fillRect(19, 3.9, 3, 2.6)
    // cockpit glass with specular
    const ck = ctx.createRadialGradient(0.8, -1.4, 0.5, 2, 0, 5)
    ck.addColorStop(0, '#fff7ed')
    ck.addColorStop(0.5, '#fca5a5')
    ck.addColorStop(1, '#b91c1c')
    ctx.fillStyle = ck
    ctx.beginPath()
    ctx.arc(2, 0, 4.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawLaser() {
    if (this.phase !== 'playing' || this.isTouch || !this.mouse.seen || this.dying) return
    const ctx = this.ctx
    const len = 560
    const x0 = this.p.x + this.p.aimX * 22
    const y0 = this.p.y + this.p.aimY * 22
    const x1 = x0 + this.p.aimX * len
    const y1 = y0 + this.p.aimY * len
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    const c = this.odActive > 0 ? '255,210,59' : '255,68,68'
    g.addColorStop(0, `rgba(${c},0.32)`)
    g.addColorStop(1, `rgba(${c},0)`)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = g
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    ctx.restore()
  }

  private drawLowHp() {
    if (this.phase !== 'playing' || this.dying) return
    const frac = this.p.hp / this.stats.maxHp
    if (frac >= 0.3) return
    const { w, h } = this.view
    const ctx = this.ctx
    const a = 0.16 + 0.12 * Math.sin(performance.now() / 150)
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.32,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72,
    )
    g.addColorStop(0, 'rgba(255,0,0,0)')
    g.addColorStop(1, `rgba(255,0,0,${a})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  private drawCrosshair() {
    const show = this.phase === 'playing' && !this.isTouch && this.mouse.seen
    this.canvas.style.cursor = show ? 'none' : ''
    if (!show) return
    const ctx = this.ctx
    const x = this.mouse.x
    const y = this.mouse.y
    this.crossPulse = Math.max(0, this.crossPulse - 0.07)
    const gap = 6 + this.crossPulse * 8
    const len = 8
    const col = this.odActive > 0 ? '#ffd23b' : '#ff4444'
    ctx.save()
    ctx.strokeStyle = col
    ctx.lineWidth = 2
    ctx.shadowColor = col
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.moveTo(x - gap - len, y)
    ctx.lineTo(x - gap, y)
    ctx.moveTo(x + gap, y)
    ctx.lineTo(x + gap + len, y)
    ctx.moveTo(x, y - gap - len)
    ctx.lineTo(x, y - gap)
    ctx.moveTo(x, y + gap)
    ctx.lineTo(x, y + gap + len)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, 1.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawTouchUlt() {
    if (!this.isTouch || this.phase !== 'playing') return
    const ctx = this.ctx
    const { w, h } = this.view
    const bx = w / 2
    const by = h - 72
    const ready = this.od >= 1 && this.odActive <= 0
    const active = this.odActive > 0
    ctx.save()
    ctx.beginPath()
    ctx.arc(bx, by, 30, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill()
    ctx.strokeStyle = active ? '#ffd23b' : 'rgba(255,210,59,0.35)'
    ctx.lineWidth = 3
    ctx.stroke()
    const p = active ? this.odActive / 5 : this.od
    ctx.beginPath()
    ctx.arc(bx, by, 30, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
    ctx.strokeStyle =
      ready && !active
        ? Math.floor(performance.now() / 250) % 2 === 0
          ? '#ffd23b'
          : '#ffffff'
        : '#ffd23b'
    ctx.stroke()
    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = ready || active ? '#ffd23b' : 'rgba(231,229,228,0.6)'
    ctx.fillText(active ? 'ON' : ready ? 'ULT' : `${Math.floor(this.od * 100)}%`, bx, by + 4)
    ctx.restore()
  }

  private drawBullets() {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (const b of this.bullets) {
      const len = 0.022
      ctx.strokeStyle = b.crit ? '#ff5c5c' : '#ffd23b'
      ctx.lineWidth = b.r * 2
      ctx.beginPath()
      ctx.moveTo(b.x - b.vx * len, b.y - b.vy * len)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      if (b.crit || b.od) {
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r * 0.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private drawOrbs() {
    if (this.stats.orbs <= 0 || this.dying) return
    const ctx = this.ctx
    const R = 74
    for (let i = 0; i < this.stats.orbs; i++) {
      const a = this.orbAngle + (i / this.stats.orbs) * Math.PI * 2
      const ox = this.p.x + Math.cos(a) * R
      const oy = this.p.y + Math.sin(a) * R
      ctx.save()
      ctx.translate(ox, oy)
      ctx.rotate(this.orbAngle * 3)
      ctx.fillStyle = '#e7e5e4'
      ctx.strokeStyle = '#ff6b35'
      ctx.lineWidth = 2
      poly(ctx, 0, 0, 10, 3, 0)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawFloaters() {
    const ctx = this.ctx
    ctx.textAlign = 'center'
    for (const f of this.floaters) {
      const a = clamp(f.life / 0.9, 0, 1)
      ctx.globalAlpha = a
      ctx.font = `bold ${f.size}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, f.y)
    }
    ctx.globalAlpha = 1
  }

  private drawHud() {
    const ctx = this.ctx
    const { ox, oy, scale } = this.view
    const aw = ARENA_W * scale
    const ah = ARENA_H * scale
    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

    // score (top-left)
    ctx.textAlign = 'left'
    ctx.font = `600 10px ${mono}`
    ctx.fillStyle = 'rgba(231,229,228,0.5)'
    ctx.fillText('SCORE', ox + 18, oy + 22)
    ctx.font = `bold 26px ${mono}`
    ctx.fillStyle = '#f5f5f4'
    ctx.fillText(String(this.score).padStart(6, '0'), ox + 18, oy + 48)
    const mult = this.comboMult()
    if (mult > 1 || this.combo > 0) {
      ctx.font = `bold 14px ${mono}`
      ctx.fillStyle = mult >= 4 ? '#ff4444' : '#f59e0b'
      ctx.fillText(`x${mult} COMBO ${this.combo}`, ox + 18, oy + 68)
    }

    // wave (top-center)
    ctx.textAlign = 'center'
    ctx.font = `600 10px ${mono}`
    ctx.fillStyle = 'rgba(231,229,228,0.5)'
    ctx.fillText('WAVE', ox + aw / 2, oy + 22)
    ctx.font = `bold 24px ${mono}`
    ctx.fillStyle = '#f5f5f4'
    ctx.fillText(String(this.wave).padStart(2, '0'), ox + aw / 2, oy + 46)
    const remaining = this.enemies.length + this.markers.length + this.spawnQueue.length
    if (this.phase === 'playing' && remaining > 0) {
      ctx.font = `600 11px ${mono}`
      ctx.fillStyle = 'rgba(255,68,68,0.85)'
      ctx.fillText(`HOSTILES ${remaining}`, ox + aw / 2, oy + 64)
    }

    // boss bar
    const boss = this.enemies.find((e) => e.kind === 'boss')
    if (boss) {
      const bw = aw * 0.46
      const bx = ox + aw / 2 - bw / 2
      const by = oy + 88
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(bx - 2, by - 2, bw + 4, 12)
      ctx.fillStyle = '#7f1d1d'
      ctx.fillRect(bx, by, bw, 8)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 8)
      ctx.font = `bold 10px ${mono}`
      ctx.fillStyle = '#fca5a5'
      ctx.textAlign = 'center'
      ctx.fillText('THE BRUTE', ox + aw / 2, by - 6)
    }

    // hp bar (bottom-left)
    const hw = Math.min(250, aw * 0.3)
    const hx = ox + 18
    const hy = oy + ah - 34
    const hpFrac = clamp(this.p.hp / this.stats.maxHp, 0, 1)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(hx - 2, hy - 2, hw + 4, 16)
    ctx.fillStyle = '#26262b'
    ctx.fillRect(hx, hy, hw, 12)
    const lowBlink = hpFrac < 0.3 && Math.floor(performance.now() / 200) % 2 === 0
    ctx.fillStyle = lowBlink ? '#ffffff' : hpFrac > 0.5 ? '#ef4444' : '#ff9f1a'
    ctx.fillRect(hx, hy, hw * hpFrac, 12)
    ctx.font = `bold 10px ${mono}`
    ctx.textAlign = 'left'
    ctx.fillStyle = '#f5f5f4'
    ctx.fillText(
      `HULL ${Math.max(0, Math.ceil(this.p.hp))}/${Math.round(this.stats.maxHp)}`,
      hx,
      hy - 7,
    )

    // overdrive meter (below hull)
    const oy2 = hy + 20
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(hx - 2, oy2 - 2, hw + 4, 12)
    ctx.fillStyle = '#26262b'
    ctx.fillRect(hx, oy2, hw, 8)
    const odFrac = this.odActive > 0 ? this.odActive / 5 : this.od
    const odReady = this.od >= 1 && this.odActive <= 0
    if (odFrac > 0) {
      ctx.fillStyle =
        this.odActive > 0
          ? '#ff9f1a'
          : odReady
            ? Math.floor(performance.now() / 250) % 2 === 0
              ? '#ffd23b'
              : '#ffffff'
            : '#b8860b'
      ctx.fillRect(hx, oy2, hw * clamp(odFrac, 0, 1), 8)
    }
    ctx.font = `bold 10px ${mono}`
    ctx.textAlign = 'left'
    ctx.fillStyle = odReady || this.odActive > 0 ? '#ffd23b' : 'rgba(231,229,228,0.5)'
    ctx.fillText(
      this.odActive > 0
        ? 'OVERDRIVE ACTIVE'
        : odReady
          ? this.isTouch
            ? 'OVERDRIVE READY — TAP ULT'
            : 'OVERDRIVE READY — PRESS [E]'
          : `OVERDRIVE ${Math.floor(this.od * 100)}%`,
      hx,
      oy2 - 6,
    )

    // dash (bottom-right)
    const dx0 = ox + aw - 18
    const dy0 = oy + ah - 34
    const dw = 96
    const dashFrac = 1 - clamp(this.p.dashCdT / this.stats.dashCd, 0, 1)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(dx0 - dw - 2, dy0 - 2, dw + 4, 16)
    ctx.fillStyle = '#26262b'
    ctx.fillRect(dx0 - dw, dy0, dw, 12)
    ctx.fillStyle = dashFrac >= 1 ? (Math.floor(performance.now() / 300) % 2 === 0 ? '#f5f5f4' : '#a8a29e') : '#57534e'
    ctx.fillRect(dx0 - dw, dy0, dw * dashFrac, 12)
    ctx.font = `bold 10px ${mono}`
    ctx.textAlign = 'right'
    ctx.fillStyle = dashFrac >= 1 ? '#f5f5f4' : 'rgba(231,229,228,0.5)'
    ctx.fillText(dashFrac >= 1 ? 'DASH READY' : 'DASH', dx0, dy0 - 7)
  }

  private drawBanner() {
    if (this.bannerT <= 0) return
    const ctx = this.ctx
    const { ox, oy, scale } = this.view
    const aw = ARENA_W * scale
    const ah = ARENA_H * scale
    const a = clamp(this.bannerT / 0.4, 0, 1) * clamp((2.1 - this.bannerT) / 0.3, 0, 1)
    ctx.save()
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.font = `bold ${Math.max(22, 34 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.fillStyle = '#f5f5f4'
    ctx.shadowColor = 'rgba(239,68,68,0.8)'
    ctx.shadowBlur = 18
    ctx.fillText(this.banner, ox + aw / 2, oy + ah * 0.42)
    ctx.restore()
  }

  private drawSticks() {
    if (!this.isTouch) return
    const ctx = this.ctx
    for (const s of [this.touchMove, this.touchAim]) {
      if (!s.active) continue
      ctx.save()
      ctx.strokeStyle = 'rgba(245,245,244,0.25)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(s.ox, s.oy, 56, 0, Math.PI * 2)
      ctx.stroke()
      const dx = s.x - s.ox
      const dy = s.y - s.oy
      const m = Math.hypot(dx, dy)
      const k = m > 56 ? 56 / m : 1
      ctx.fillStyle = s === this.touchMove ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'
      ctx.beginPath()
      ctx.arc(s.ox + dx * k, s.oy + dy * k, 22, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}
