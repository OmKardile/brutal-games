// BRUTAL // MERGE — the drop pit.
//
// Steer the dropper, release an orb, watch physics do its thing. Two orbs of
// the same tier that touch SLAM together into the next tier up — chains pay
// combo multipliers. The pit is not infinite: let resting orbs sit above the
// danger line for 3 seconds and the run collapses.
//
// The brutal twist: fusing into tier 11 forges a SINGULARITY — it detonates,
// vaporizing every orb nearby for bonus points. Deadlock insurance + the
// biggest dopamine hit in the game.
//
// Physics: fixed-radii circles in a fixed world (440x580 units, scaled to
// screen), gravity + impulse response with positional correction, 2 substeps
// per frame (puzzle-skill rule: resolve to stability; merges are event-driven
// each substep and cascade naturally on later steps).
//
// The engine owns the canvas only. Menus / HUD / leaderboard live in the page
// (src/app/merge/page.tsx) and receive events through the callback.

import { GamepadReader, type PadSnapshot } from './gamepad'
import { paletteFor, type GamePalette, type GameThemeMode } from './theme'

export type MergePhase = 'idle' | 'playing' | 'over'

export interface MergeStats {
  score: number
  merges: number
  highestTier: number
  bestCombo: number
  singularities: number
}

export type MergeEvent =
  | { type: 'phase'; phase: MergePhase }
  | { type: 'score'; score: number; combo: number; tier: number }
  | { type: 'gameover'; stats: MergeStats }
  | { type: 'padstart' }

// ------------------------------------------------------------------ world

const PW = 440 // pit width, world units
const PH = 580 // pit height
const DANGER_Y = 118
const DANGER_GRACE = 3 // seconds above the line before collapse
const GRAVITY = 980
const RESTITUTION = 0.14
const AIR_DAMP = 0.996
const CORRECTION = 0.55
const SLOP = 0.4
const MAX_V = 980
const DROP_COOLDOWN = 360 // ms
const COMBO_WINDOW = 800 // ms between merges that still combo
const SUBSTEPS = 2

const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const
const RADIUS: Record<number, number> = {}
for (const t of TIERS) RADIUS[t] = 15 + Math.pow(t, 0.78) * 7.4

// brutal heat ramp: maroon -> ember -> amber -> white-hot
const TIER_COLOR: Record<number, string> = {
  1: '#8b1f1f',
  2: '#b91c1c',
  3: '#dc2626',
  4: '#ea580c',
  5: '#f97316',
  6: '#f59e0b',
  7: '#eab308',
  8: '#facc15',
  9: '#fde047',
  10: '#fef9c3',
  11: '#ffffff',
}

// merge points by the tier PRODUCED (triangular-ish escalation)
const MERGE_PTS: Record<number, number> = {
  2: 2,
  3: 6,
  4: 12,
  5: 20,
  6: 30,
  7: 42,
  8: 56,
  9: 72,
  10: 90,
  11: 110,
}

// ------------------------------------------------------------------ audio

class MergeAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lastAt: Record<string, number> = {}
  muted = false

  ensure(): void {
    if (this.ctx || typeof window === 'undefined') return
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.5
    this.master.connect(this.ctx.destination)
  }

  private throttled(key: string, ms: number): boolean {
    const now = performance.now()
    if ((this.lastAt[key] ?? -1e9) + ms > now) return true
    this.lastAt[key] = now
    return false
  }

  private tone(freq: number, endFreq: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur)
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(dur: number, gain: number, freq: number): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.value = gain
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master)
    src.start(t0)
  }

  drop(): void {
    this.tone(180, 120, 0.06, 'square', 0.12)
  }

  // merge chime — pitch climbs with tier, depth grows too (two-osc trick)
  merge(tier: number, combo: number): void {
    if (this.throttled('merge', 45)) return
    const base = 300 + tier * 42
    this.tone(base, base, 0.12, 'triangle', 0.2)
    this.tone(base * 1.5, base * 1.5, 0.1, 'triangle', 0.12, 0.03)
    if (combo >= 2) this.tone(base * 2, base * 2, 0.12, 'square', 0.08, 0.06)
  }

  singularity(): void {
    this.tone(60, 30, 0.8, 'sawtooth', 0.3)
    this.tone(880, 120, 0.6, 'triangle', 0.22)
    this.noise(0.7, 0.3, 600)
  }

  warn(): void {
    if (this.throttled('warn', 420)) return
    this.tone(660, 660, 0.07, 'square', 0.14)
    this.tone(660, 660, 0.07, 'square', 0.12, 0.12)
  }

  over(): void {
    this.tone(220, 46, 0.6, 'sawtooth', 0.24)
    this.noise(0.5, 0.2, 400)
  }
}

// ------------------------------------------------------------------ types

interface Orb {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  tier: number
  r: number
  age: number
  spawnT: number // 0..1 scale-in animation
  flash: number
  dead: boolean
  deadAt: number // for collapse shrink-out
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
}

interface Ring {
  x: number
  y: number
  r: number
  life: number
  color: string
}

interface Pop {
  x: number
  y: number
  text: string
  color: string
  life: number
  size: number
}

// ------------------------------------------------------------------ engine

export class MergeGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private emit: (ev: MergeEvent) => void
  private audio = new MergeAudio()

  private raf = 0
  private lastT = 0
  private dead = false
  private pad = new GamepadReader()
  private padSnap: PadSnapshot | null = null

  private pal: GamePalette = paletteFor('merge', 'night')

  // layout
  private W = 0
  private H = 0
  private dpr = 1
  private scale = 1
  private ox = 0
  private oy = 0

  // run state
  private phase: MergePhase = 'idle'
  private score = 0
  private merges = 0
  private highestTier = 1
  private bestCombo = 1
  private singularities = 0
  private combo = 1
  private lastMergeAt = 0

  // orbs
  private orbs: Orb[] = []
  private nextId = 1
  private dangerT = 0

  // dropper
  private dropX = PW / 2
  private currentTier = 1
  private nextTier = 2
  private cooldownUntil = 0
  private keyDir = 0
  private pointerX: number | null = null
  private lastDropAt = 0

  // death
  private deathAt = 0
  private overEmitted = false

  // fx
  private trauma = 0
  private shakeT = 0
  private particles: Particle[] = []
  private rings: Ring[] = []
  private pops: Pop[] = []
  private flash = 0
  private flashColor = '#ffffff'

  // attract
  private attractNext = 0

  constructor(canvas: HTMLCanvasElement, emit: (ev: MergeEvent) => void) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    this.ctx = ctx
    this.emit = emit

    this.resize()
    this.rollTiers()

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('resize', this.onResize)

    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.pad.destroy()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('resize', this.onResize)
  }

  setMuted(m: boolean): void {
    this.audio.muted = m
  }

  setTheme(mode: GameThemeMode): void {
    this.pal = paletteFor('merge', mode)
  }

  start(): void {
    this.audio.ensure()
    this.score = 0
    this.merges = 0
    this.highestTier = 1
    this.bestCombo = 1
    this.singularities = 0
    this.combo = 1
    this.dangerT = 0
    this.orbs.length = 0
    this.particles.length = 0
    this.rings.length = 0
    this.pops.length = 0
    this.trauma = 0
    this.flash = 0
    this.overEmitted = false
    this.dropX = PW / 2
    this.rollTiers()
    this.phase = 'playing'
    this.emit({ type: 'phase', phase: 'playing' })
  }

  // ------------------------------------------------------------- input

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    this.audio.ensure()
    this.pointerX = this.toWorldX(e.clientX)
    if (this.phase === 'playing') this.drop()
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.pointerX = this.toWorldX(e.clientX)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keyDir = -1
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keyDir = 1
    else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')
      ) {
        return
      }
      e.preventDefault()
      this.audio.ensure()
      if (this.phase === 'playing') this.drop()
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (
      ((e.code === 'ArrowLeft' || e.code === 'KeyA') && this.keyDir === -1) ||
      ((e.code === 'ArrowRight' || e.code === 'KeyD') && this.keyDir === 1)
    ) {
      this.keyDir = 0
    }
  }

  private onResize = (): void => this.resize()

  private toWorldX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect()
    return (clientX - rect.left - this.ox) / this.scale
  }

  // ------------------------------------------------------------- layout

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.W = Math.max(320, rect.width)
    this.H = Math.max(360, rect.height)
    this.canvas.width = Math.round(this.W * this.dpr)
    this.canvas.height = Math.round(this.H * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.scale = Math.min((this.W - 28) / PW, (this.H - 120) / PH)
    this.ox = (this.W - PW * this.scale) / 2
    this.oy = Math.max(64, (this.H - PH * this.scale) / 2 + 14)
  }

  private rollTiers(): void {
    const roll = Math.random()
    this.currentTier = roll < 0.5 ? 1 : roll < 0.82 ? 2 : 3
    const roll2 = Math.random()
    this.nextTier = roll2 < 0.5 ? 1 : roll2 < 0.82 ? 2 : 3
  }

  // ------------------------------------------------------------- dropper

  private drop(): void {
    const now = performance.now()
    if (now < this.cooldownUntil || now - this.lastDropAt < 60) return
    this.lastDropAt = now
    this.cooldownUntil = now + DROP_COOLDOWN
    const r = RADIUS[this.currentTier]
    const x = clamp(this.dropX, r + 2, PW - r - 2)
    this.orbs.push({
      id: this.nextId++,
      x,
      y: 40,
      vx: 0,
      vy: 90,
      tier: this.currentTier,
      r,
      age: 0,
      spawnT: 0,
      flash: 0,
      dead: false,
      deadAt: 0,
    })
    this.currentTier = this.nextTier
    const roll = Math.random()
    this.nextTier = roll < 0.5 ? 1 : roll < 0.82 ? 2 : 3
    this.audio.drop()
    this.spawnParticles(x, 40, 4, TIER_COLOR[this.currentTier], 90)
  }

  // ------------------------------------------------------------- physics

  private physicsStep(dt: number, now: number): void {
    // integrate
    for (const o of this.orbs) {
      if (o.dead) continue
      o.age += dt
      o.vy += GRAVITY * dt
      o.vx *= AIR_DAMP
      o.vy *= AIR_DAMP
      const v = Math.hypot(o.vx, o.vy)
      if (v > MAX_V) {
        o.vx = (o.vx / v) * MAX_V
        o.vy = (o.vy / v) * MAX_V
      }
      o.x += o.vx * dt
      o.y += o.vy * dt
    }

    // walls
    for (const o of this.orbs) {
      if (o.dead) continue
      if (o.x - o.r < 0) {
        o.x = o.r
        o.vx = Math.abs(o.vx) * RESTITUTION
      } else if (o.x + o.r > PW) {
        o.x = PW - o.r
        o.vx = -Math.abs(o.vx) * RESTITUTION
      }
      if (o.y + o.r > PH) {
        o.y = PH - o.r
        o.vy = -Math.abs(o.vy) * RESTITUTION
        o.vx *= 0.94 // floor friction
      }
    }

    // circle-circle (single pass per substep, positional + impulse)
    const n = this.orbs.length
    for (let i = 0; i < n; i++) {
      const a = this.orbs[i]
      if (a.dead) continue
      for (let j = i + 1; j < n; j++) {
        const b = this.orbs[j]
        if (b.dead) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        const min = a.r + b.r
        if (dist >= min || dist === 0) continue

        // same tier touching -> merge (event-driven cascade)
        if (a.tier === b.tier && a.tier < 11) {
          this.mergeOrbs(a, b, now)
          continue
        }

        // positional correction
        const nx = dx / dist
        const ny = dy / dist
        const pen = (min - dist + SLOP) * CORRECTION
        const total = a.r * a.r + b.r * b.r
        a.x -= nx * pen * (b.r * b.r / total)
        a.y -= ny * pen * (b.r * b.r / total)
        b.x += nx * pen * (a.r * a.r / total)
        b.y += ny * pen * (a.r * a.r / total)

        // impulse
        const rvx = b.vx - a.vx
        const rvy = b.vy - a.vy
        const velN = rvx * nx + rvy * ny
        if (velN > 0) continue
        const jImp = -(1 + RESTITUTION) * velN / 2
        a.vx -= jImp * nx
        a.vy -= jImp * ny
        b.vx += jImp * nx
        b.vy += jImp * ny
      }
    }

    // sweep dead
    if (this.orbs.some((o) => o.dead && now - o.deadAt > 260)) {
      this.orbs = this.orbs.filter((o) => !o.dead)
    }
  }

  private mergeOrbs(a: Orb, b: Orb, now: number): void {
    const tier = a.tier + 1
    // combo window
    if (now - this.lastMergeAt < COMBO_WINDOW) {
      this.combo = Math.min(6, this.combo + 1)
    } else {
      this.combo = 1
    }
    this.lastMergeAt = now
    this.bestCombo = Math.max(this.bestCombo, this.combo)

    const pts = (MERGE_PTS[tier] ?? 100) * (1 + (this.combo - 1) * 0.5)
    this.score += Math.round(pts)
    this.merges++
    this.highestTier = Math.max(this.highestTier, tier)

    // fused orb at the lower contact point (feels heavier)
    const low = a.y > b.y ? a : b
    const high = a.y > b.y ? b : a
    const fused: Orb = {
      id: this.nextId++,
      x: (low.x * 2 + high.x) / 3,
      y: (low.y * 2 + high.y) / 3,
      vx: (a.vx + b.vx) * 0.25,
      vy: (a.vy + b.vy) * 0.25,
      tier,
      r: RADIUS[tier],
      age: 0,
      spawnT: 0,
      flash: 1,
      dead: false,
      deadAt: 0,
    }
    a.dead = true
    a.deadAt = now
    b.dead = true
    b.deadAt = now
    this.orbs.push(fused)

    // juice
    this.addTrauma(0.1 + tier * 0.035)
    this.spawnParticles(fused.x, fused.y, 6 + tier * 2, TIER_COLOR[tier], 120 + tier * 26)
    this.rings.push({ x: fused.x, y: fused.y, r: fused.r, life: 1, color: TIER_COLOR[tier] })
    const comboTxt = this.combo >= 2 ? ` ×${this.combo}` : ''
    this.addPop(fused.x, fused.y - fused.r - 8, `+${Math.round(pts)}${comboTxt}`, tier >= 8 ? '#ffffff' : TIER_COLOR[tier], 13 + Math.min(6, tier))
    this.audio.merge(tier, this.combo)
    this.pad.rumble(Math.min(1, 0.2 + tier * 0.08), 0.3, 60 + tier * 14)

    if (tier === 11) this.singularity(fused, now)

    this.emit({ type: 'score', score: this.score, combo: this.combo, tier: this.highestTier })
  }

  /** tier 11 forged: detonate and vaporize nearby orbs for bonus points */
  private singularity(core: Orb, now: number): void {
    this.singularities++
    const R = 175
    let bonus = 0
    for (const o of this.orbs) {
      if (o.dead || o === core) continue
      if (Math.hypot(o.x - core.x, o.y - core.y) < R + o.r) {
        o.dead = true
        o.deadAt = now
        bonus += (MERGE_PTS[o.tier + 1] ?? 40) * 2
        this.spawnParticles(o.x, o.y, 8, TIER_COLOR[o.tier], 220)
      }
    }
    // the singularity itself burns out after the blast
    core.dead = true
    core.deadAt = now + 120
    if (bonus > 0) {
      this.score += bonus
      this.addPop(core.x, core.y - 40, `SINGULARITY +${bonus}`, '#ffffff', 20)
    } else {
      this.addPop(core.x, core.y - 40, 'SINGULARITY', '#ffffff', 20)
    }
    this.addTrauma(0.85)
    this.flash = 0.45
    this.flashColor = '#ffffff'
    this.rings.push({ x: core.x, y: core.y, r: 20, life: 1, color: '#ffffff' })
    this.rings.push({ x: core.x, y: core.y, r: 60, life: 1, color: this.pal.accent.hot })
    this.spawnParticles(core.x, core.y, 40, ['#ffffff', '#fde047', this.pal.accent.main], 400, 5)
    this.audio.singularity()
    this.pad.rumble(1, 1, 320)
    this.emit({ type: 'score', score: this.score, combo: this.combo, tier: this.highestTier })
  }

  // ------------------------------------------------------------- danger

  private updateDanger(dt: number): void {
    let danger = false
    for (const o of this.orbs) {
      if (o.dead) continue
      if (o.y - o.r < DANGER_Y && Math.abs(o.vy) < 90 && o.age > 0.7) {
        danger = true
        break
      }
    }
    if (danger) {
      this.dangerT += dt
      if (Math.floor(this.dangerT * 2) !== Math.floor((this.dangerT - dt) * 2)) this.audio.warn()
      if (this.dangerT >= DANGER_GRACE) this.gameOver()
    } else {
      this.dangerT = Math.max(0, this.dangerT - dt * 2)
    }
  }

  private gameOver(): void {
    if (this.phase !== 'playing') return
    this.phase = 'over'
    this.deathAt = performance.now()
    this.overEmitted = true
    this.addTrauma(1)
    this.flash = 0.5
    this.flashColor = this.pal.danger
    for (const o of this.orbs) {
      if (!o.dead && Math.random() < 0.7) {
        o.dead = true
        o.deadAt = performance.now() + Math.random() * 300
        this.spawnParticles(o.x, o.y, 5, TIER_COLOR[o.tier], 160)
      }
    }
    this.audio.over()
    this.pad.rumble(1, 0.6, 300)
    this.emit({ type: 'phase', phase: 'over' })
    this.emit({
      type: 'gameover',
      stats: {
        score: this.score,
        merges: this.merges,
        highestTier: this.highestTier,
        bestCombo: this.bestCombo,
        singularities: this.singularities,
      },
    })
  }

  // ------------------------------------------------------------- fx utils

  private addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a)
  }

  private addPop(x: number, y: number, text: string, color: string, size: number): void {
    this.pops.push({ x, y, text, color, life: 1, size })
  }

  private spawnParticles(x: number, y: number, n: number, color: string, speed: number, size = 2.6): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2
      const sp = speed * (0.4 + Math.random() * 0.8)
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0.35 + Math.random() * 0.4,
        maxLife: 0.75,
        size: size * (0.6 + Math.random() * 0.7),
        color: Math.random() < 0.3 ? '#ffffff' : color,
      })
    }
  }

  // ------------------------------------------------------------- update

  private update(dt: number, now: number): void {
    this.padSnap = this.pad.poll()
    const snap = this.padSnap
    if (this.phase !== 'playing' && (snap.a || snap.start)) {
      this.emit({ type: 'padstart' })
    }

    // ---- attract mode ---------------------------------------------------
    if (this.phase === 'idle') {
      if (now > this.attractNext) {
        this.attractNext = now + 1100 + Math.random() * 700
        const roll = Math.random()
        const tier = roll < 0.5 ? 1 : roll < 0.82 ? 2 : 3
        const r = RADIUS[tier]
        this.orbs.push({
          id: this.nextId++,
          x: r + 8 + Math.random() * (PW - r * 2 - 16),
          y: 40,
          vx: 0,
          vy: 60,
          tier,
          r,
          age: 0,
          spawnT: 0,
          flash: 0,
          dead: false,
          deadAt: 0,
        })
        // attract merges work with a fake "now" clock — same code path
      }
      if (this.orbs.length > 26) {
        this.orbs.splice(0, 6).forEach((o) => this.spawnParticles(o.x, o.y, 3, TIER_COLOR[o.tier], 100))
      }
    }

    // ---- dropper steering ------------------------------------------------
    if (this.phase === 'playing') {
      let target = this.dropX
      if (this.pointerX !== null) target = this.pointerX
      if (this.keyDir !== 0) {
        target = this.dropX + this.keyDir * 520 * dt
        this.pointerX = null
      }
      // gamepad stick — analog
      if (snap && Math.abs(snap.move.x) > 0.06) {
        target = this.dropX + snap.move.x * 560 * dt
        this.pointerX = null
      }
      this.dropX = clamp(target, 24, PW - 24)
      if (snap && (snap.a || snap.rt || snap.x)) this.drop()
    }

    // ---- physics (substeps) -----------------------------------------------
    const sub = dt / SUBSTEPS
    for (let s = 0; s < SUBSTEPS; s++) {
      this.physicsStep(sub, now)
    }

    // ---- danger + score events ----------------------------------------------
    if (this.phase === 'playing') {
      this.updateDanger(dt)
    }

    // ---- fx decay ------------------------------------------------------------
    this.trauma = Math.max(0, this.trauma - 1.25 * dt)
    this.shakeT += dt * 30
    this.flash = Math.max(0, this.flash - dt * 2.2)

    for (const o of this.orbs) {
      o.spawnT = Math.min(1, o.spawnT + dt * 6)
      o.flash = Math.max(0, o.flash - dt * 4)
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 300 * dt
      p.life -= dt
      if (p.life <= 0) this.particles.splice(i, 1)
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.r += 260 * dt
      r.life -= dt * 2
      if (r.life <= 0) this.rings.splice(i, 1)
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.y -= 40 * dt
      p.life -= dt * 1.1
      if (p.life <= 0) this.pops.splice(i, 1)
    }
  }

  // ------------------------------------------------------------- render

  private render(now: number): void {
    const ctx = this.ctx
    const p = this.pal
    const shake = this.trauma * this.trauma
    const cooling = now < this.cooldownUntil

    ctx.save()
    ctx.translate(
      12 * shake * Math.sin(this.shakeT * 1.7),
      9 * shake * Math.sin(this.shakeT * 2.3),
    )

    // bg
    ctx.fillStyle = p.bg
    ctx.fillRect(-24, -24, this.W + 48, this.H + 48)

    // ambient blobs — subtle color field
    const blobs: [number, number, number, string][] = [
      [this.W * 0.2, this.H * 0.25, this.H * 0.4, TIER_COLOR[4]],
      [this.W * 0.8, this.H * 0.7, this.H * 0.45, TIER_COLOR[7]],
      [this.W * 0.6, this.H * 0.15, this.H * 0.3, this.pal.accent.main],
    ]
    for (const [bx, by, br, color] of blobs) {
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
      g.addColorStop(0, hexA(color, 0.05))
      g.addColorStop(1, hexA(color, 0))
      ctx.fillStyle = g
      ctx.fillRect(bx - br, by - br, br * 2, br * 2)
    }

    // ---- pit transform ---------------------------------------------------
    ctx.save()
    ctx.translate(this.ox, this.oy)
    ctx.scale(this.scale, this.scale)

    // pit interior
    ctx.fillStyle = hexA(p.ink, 0.03)
    ctx.fillRect(0, 0, PW, PH)
    ctx.strokeStyle = p.grid
    ctx.lineWidth = 1
    for (let i = 1; i < 8; i++) {
      const y = (PH / 8) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(PW, y)
      ctx.stroke()
    }

    // pit walls
    ctx.strokeStyle = p.inkDim
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(2, -60)
    ctx.lineTo(2, PH + 2)
    ctx.lineTo(PW - 2, PH + 2)
    ctx.lineTo(PW - 2, -60)
    ctx.stroke()

    // ---- danger line --------------------------------------------------------
    const warnLevel = this.phase === 'playing' ? Math.min(1, this.dangerT / DANGER_GRACE) : 0
    const blink = warnLevel > 0 ? 0.5 + 0.5 * Math.sin(now / (warnLevel > 0.6 ? 90 : 180)) : 1
    const lineColor = warnLevel > 0 ? mixColor(p.danger, blink) : hexA(p.inkFaint, 0.7)
    ctx.strokeStyle = lineColor
    ctx.lineWidth = warnLevel > 0 ? 3 : 2
    ctx.setLineDash([10, 8])
    ctx.beginPath()
    ctx.moveTo(4, DANGER_Y)
    ctx.lineTo(PW - 4, DANGER_Y)
    ctx.stroke()
    ctx.setLineDash([])
    if (warnLevel > 0 && this.phase === 'playing') {
      ctx.font = '900 26px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = p.danger
      ctx.fillText(`${Math.max(0, DANGER_GRACE - this.dangerT).toFixed(1)}`, PW / 2, DANGER_Y - 12)
    }

    // ---- orbs -----------------------------------------------------------------
    for (const o of this.orbs) {
      let r = o.r
      let alpha = 1
      if (o.dead) {
        const t = Math.min(1, (now - o.deadAt) / 260)
        r = o.r * (1 - Math.max(0, t))
        alpha = 1 - Math.max(0, t)
        if (r <= 1 || alpha <= 0) continue
      } else if (o.spawnT < 1) {
        // ease-out-back pop-in
        const s = o.spawnT
        r = o.r * (1 + 0.35 * Math.sin(s * Math.PI) * (1 - s)) * Math.min(1, s * 1.6)
      }

      const col = TIER_COLOR[o.tier]
      // body
      ctx.globalAlpha = alpha
      const g = ctx.createRadialGradient(o.x - r * 0.3, o.y - r * 0.35, r * 0.1, o.x, o.y, r)
      g.addColorStop(0, lighten(col, 18))
      g.addColorStop(1, col)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2)
      ctx.fill()
      // rim
      ctx.strokeStyle = lighten(col, -22)
      ctx.lineWidth = Math.max(1.5, r * 0.1)
      ctx.stroke()
      // gloss
      ctx.globalAlpha = alpha * 0.5
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(o.x - r * 0.32, o.y - r * 0.4, r * 0.22, r * 0.13, -0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = alpha
      // tier number
      if (o.tier < 11 && r > 12) {
        ctx.font = `900 ${Math.max(10, r * 0.62)}px ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = o.tier <= 3 ? '#fecaca' : '#3f2d0a'
        ctx.fillText(String(o.tier), o.x, o.y + 1)
      }
      // flash ring on fresh merge
      if (o.flash > 0) {
        ctx.globalAlpha = alpha * o.flash * 0.8
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(o.x, o.y, r + 5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // ---- dropper -----------------------------------------------------------------
    if (this.phase === 'playing') {
      const r = RADIUS[this.currentTier]
      const bob = Math.sin(now / 300) * 3
      const dy = 34 + bob
      // aim line
      ctx.strokeStyle = hexA(p.inkFaint, 0.5)
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 10])
      ctx.beginPath()
      ctx.moveTo(this.dropX, dy + r)
      ctx.lineTo(this.dropX, PH)
      ctx.stroke()
      ctx.setLineDash([])
      // hanging orb
      const col = TIER_COLOR[this.currentTier]
      const g2 = ctx.createRadialGradient(this.dropX - r * 0.3, dy - r * 0.35, r * 0.1, this.dropX, dy, r)
      g2.addColorStop(0, lighten(col, 18))
      g2.addColorStop(1, col)
      ctx.fillStyle = g2
      ctx.beginPath()
      ctx.arc(this.dropX, dy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = lighten(col, -22)
      ctx.lineWidth = 3
      ctx.stroke()
      // reload indicator
      if (cooling) {
        const t = 1 - (this.cooldownUntil - now) / DROP_COOLDOWN
        ctx.strokeStyle = p.accent.main
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(this.dropX, dy, r + 8, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2)
        ctx.stroke()
      }
      // next preview
      const nr = RADIUS[this.nextTier]
      ctx.globalAlpha = 0.55
      ctx.fillStyle = TIER_COLOR[this.nextTier]
      ctx.beginPath()
      ctx.arc(PW - nr - 12, -34, nr * 0.7, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.font = '900 11px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillStyle = p.inkDim
      ctx.fillText('NEXT', PW - nr * 2 - 26, -38)
    }

    // ---- particles / rings / pops -------------------------------------------------
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife)
      ctx.fillStyle = pt.color
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size)
    }
    ctx.globalAlpha = 1
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.7
      ctx.strokeStyle = r.color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    for (const pp of this.pops) {
      ctx.globalAlpha = Math.min(1, pp.life * 1.6)
      ctx.font = `900 ${pp.size}px ui-monospace, monospace`
      ctx.fillStyle = pp.color
      ctx.fillText(pp.text, pp.x, pp.y)
    }
    ctx.globalAlpha = 1

    ctx.restore() // pit transform

    // ---- flash -----------------------------------------------------------------------
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.6, this.flash)
      ctx.fillStyle = this.flashColor
      ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
      ctx.globalAlpha = 1
    }

    ctx.restore() // shake

    // death dim
    if (this.phase === 'over') {
      const t = Math.min(1, (now - this.deathAt) / 500)
      ctx.fillStyle = hexA(this.pal.bg, 0.4 * t)
      ctx.fillRect(0, 0, this.W, this.H)
    }
  }

  // --------------------------------------------------------------- loop

  private loop = (now: number): void => {
    if (this.dead) return
    const dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now
    this.update(dt, now)
    this.render(now)
    this.raf = requestAnimationFrame(this.loop)
  }
}

// ------------------------------------------------------------------ utils

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return `rgb(${r},${g},${b})`
}

function mixColor(hex: string, t: number): string {
  // flicker toward full brightness
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${0.35 + 0.65 * t})`
}
