// BRUTAL // DODGE — the one-button gauntlet.
//
// HOLD to burn upward. RELEASE to fall. That's the entire control scheme.
// Thread the ship through closing gates and drifting blocks, graze them for
// CLOSE bonuses, snag orbs parked in stupid places. Touch the hazard walls or
// any obstacle and the run is over — shatter, slow-mo, instant retry.
//
// Feel (platformer-skill numbers, adapted to continuous flight):
//   thrust accel -2350 px/s^2, gravity +1950, terminal velocity +-640,
//   ship tilt reads vy. World speed ramps 240 -> 560 px/s.
// Juice (game-feel tiers): exhaust particles while held, near-miss chime +
// spark ring, orb arpeggio, milestones every 500m, death = hit-stop + trauma
// 1.0 + shatter + slow-mo.
//
// The engine owns the canvas only. Menus / HUD / leaderboard live in the page
// (src/app/dodge/page.tsx) and receive events through the callback.

import { GamepadReader, type PadSnapshot } from './gamepad'
import { paletteFor, type GamePalette, type GameThemeMode } from './theme'

export type DodgePhase = 'idle' | 'playing' | 'over'

export interface DodgeStats {
  score: number
  distance: number // meters
  orbs: number
  nearMisses: number
}

export type DodgeEvent =
  | { type: 'phase'; phase: DodgePhase }
  | { type: 'score'; score: number; distance: number }
  | { type: 'gameover'; stats: DodgeStats }
  | { type: 'padstart' }

// ------------------------------------------------------------------ audio

class DodgeAudio {
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

  private noise(dur: number, gain: number, type: BiquadFilterType, freq: number): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const filter = this.ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.value = gain
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master)
    src.start(t0)
  }

  // granular jetpack chugs while thrusting
  thrust(): void {
    if (this.throttled('thrust', 110)) return
    this.noise(0.09, 0.07, 'bandpass', 900)
    this.tone(140, 220, 0.08, 'triangle', 0.05)
  }

  close(): void {
    if (this.throttled('close', 140)) return
    this.noise(0.16, 0.12, 'highpass', 1800)
    this.tone(880, 1240, 0.09, 'triangle', 0.1)
  }

  orb(): void {
    this.tone(660, 660, 0.07, 'square', 0.12)
    this.tone(990, 990, 0.08, 'square', 0.12, 0.06)
    this.tone(1320, 1320, 0.1, 'square', 0.1, 0.12)
  }

  milestone(): void {
    this.tone(392, 392, 0.16, 'triangle', 0.14)
    this.tone(523.25, 523.25, 0.16, 'triangle', 0.12, 0.06)
    this.tone(783.99, 783.99, 0.24, 'triangle', 0.12, 0.12)
  }

  die(): void {
    this.noise(0.6, 0.3, 'lowpass', 500)
    this.tone(180, 40, 0.6, 'sawtooth', 0.26)
    this.tone(90, 30, 0.5, 'square', 0.16, 0.04)
  }
}

// ------------------------------------------------------------------ types

interface Gate {
  kind: 'gate'
  x: number // world x (left edge of gap zone)
  gapY: number // gap center
  gapH: number
  w: number
  passed: boolean
  nearAwarded: boolean
  minClear: number // closest clearance seen while near ship x
}

interface Block {
  kind: 'block'
  x: number
  y: number
  s: number // half-size
  rot: number
  vrot: number
  drift: number // vy drift
  passed: boolean
  nearAwarded: boolean
  minClear: number
}

interface Orb {
  x: number
  y: number
  r: number
  taken: boolean
  pulse: number
}

type Obstacle = Gate | Block

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  spin?: number
  rot?: number
}

interface Pop {
  x: number
  y: number
  text: string
  color: string
  life: number
  size: number
}

interface Streak {
  x: number
  y: number
  v: number
  a: number
}

// ------------------------------------------------------------------ engine

const SHIP_R = 13
const THRUST_A = -2350
const GRAVITY_A = 1950
const VY_MAX = 640
const NEAR_MISS_PX = 26
const TRAUMA_DECAY = 1.3

export class DodgeGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private emit: (ev: DodgeEvent) => void
  private audio = new DodgeAudio()

  private raf = 0
  private lastT = 0
  private dead = false
  private pad = new GamepadReader()
  private padSnap: PadSnapshot | null = null

  private pal: GamePalette = paletteFor('dodge', 'night')

  // layout
  private W = 0
  private H = 0
  private dpr = 1

  // run state
  private phase: DodgePhase = 'idle'
  private score = 0
  private distPx = 0
  private orbs = 0
  private nearMisses = 0
  private nextMilestone = 500 // meters

  // ship
  private sy = 0
  private vy = 0
  private shipTilt = 0
  private thrustHeld = false

  // input
  private keyHeld = false
  private pointerHeld = false

  // world
  private worldSpeed = 240
  private camX = 0 // scroll offset
  private nextSpawnAt = 600 // world x for next pattern
  private obstacles: Obstacle[] = []
  private orbList: Orb[] = []

  // death
  private deathAt = 0
  private hitStopUntil = 0

  // fx
  private trauma = 0
  private shakeT = 0
  private particles: Particle[] = []
  private pops: Pop[] = []
  private streaks: Streak[] = []
  private flash = 0
  private flashColor = '#ffffff'
  private bgPulse = 0

  constructor(canvas: HTMLCanvasElement, emit: (ev: DodgeEvent) => void) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    this.ctx = ctx
    this.emit = emit

    this.resize()
    this.sy = this.H / 2
    this.seedStreaks()

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('resize', this.onResize)
    window.addEventListener('blur', this.onBlur)

    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  private onResize = (): void => {
    this.resize()
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.W = Math.max(320, rect.width)
    this.H = Math.max(320, rect.height)
    this.canvas.width = Math.round(this.W * this.dpr)
    this.canvas.height = Math.round(this.H * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  destroy(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.pad.destroy()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('blur', this.onBlur)
  }

  setMuted(m: boolean): void {
    this.audio.muted = m
  }

  setTheme(mode: GameThemeMode): void {
    this.pal = paletteFor('dodge', mode)
  }

  start(): void {
    this.audio.ensure()
    this.score = 0
    this.distPx = 0
    this.orbs = 0
    this.nearMisses = 0
    this.nextMilestone = 500
    this.worldSpeed = 240
    this.camX = 0
    this.nextSpawnAt = 600
    this.obstacles.length = 0
    this.orbList.length = 0
    this.particles.length = 0
    this.pops.length = 0
    this.trauma = 0
    this.flash = 0
    this.sy = this.H / 2
    this.vy = -140
    this.phase = 'playing'
    this.emit({ type: 'phase', phase: 'playing' })
  }

  // ------------------------------------------------------------- input

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    this.audio.ensure()
    this.pointerHeld = true
  }

  private onPointerUp = (): void => {
    this.pointerHeld = false
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'KeyW') return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) {
      return
    }
    e.preventDefault()
    this.audio.ensure()
    this.keyHeld = true
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'KeyW') return
    this.keyHeld = false
  }

  private onBlur = (): void => {
    this.keyHeld = false
    this.pointerHeld = false
  }

  // ------------------------------------------------------------ spawning

  private spawnPattern(): void {
    const roll = Math.random()
    const progress = Math.min(1, this.distPx / 26000) // difficulty curve
    const gapH = this.H * (0.36 - progress * 0.13) // 36% -> 23% of height
    const x = this.nextSpawnAt

    if (roll < 0.62) {
      // gate
      const margin = gapH / 2 + 56
      const gapY = margin + Math.random() * (this.H - margin * 2)
      this.obstacles.push({
        kind: 'gate',
        x,
        gapY,
        gapH,
        w: 62 + Math.random() * 26,
        passed: false,
        nearAwarded: false,
        minClear: 1e9,
      })
      // orb baited near the gap edge — risk/reward
      if (Math.random() < 0.55) {
        const side = Math.random() < 0.5 ? -1 : 1
        this.orbList.push({
          x: x + 30,
          y: gapY + (side * gapH) / 2 + side * 24,
          r: 9,
          taken: false,
          pulse: Math.random() * Math.PI * 2,
        })
      }
    } else {
      // drifting block cluster
      const n = 1 + Math.floor(Math.random() * 2)
      for (let i = 0; i < n; i++) {
        const s = 22 + Math.random() * 26
        this.obstacles.push({
          kind: 'block',
          x: x + i * 130,
          y: 60 + Math.random() * (this.H - 120),
          s,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 2.4,
          drift: (Math.random() - 0.5) * 46,
          passed: false,
          nearAwarded: false,
          minClear: 1e9,
        })
      }
      if (Math.random() < 0.4) {
        this.orbList.push({ x: x + 65, y: 70 + Math.random() * (this.H - 140), r: 9, taken: false, pulse: 0 })
      }
    }

    this.nextSpawnAt += 400 + Math.random() * 260 - progress * 90
  }

  // ------------------------------------------------------------- helpers

  private shipX(): number {
    return this.W * 0.26
  }

  private meters(): number {
    return Math.floor(this.distPx / 50)
  }

  private addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a)
  }

  private addPop(x: number, y: number, text: string, color: string, size: number): void {
    this.pops.push({ x, y, text, color, life: 1, size })
  }

  private burst(x: number, y: number, n: number, colors: string[], speed = 260, size = 3): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2
      const sp = speed * (0.4 + Math.random() * 0.8)
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
      })
    }
  }

  private seedStreaks(): void {
    this.streaks = Array.from({ length: 30 }, () => ({
      x: Math.random() * this.W,
      y: Math.random() * this.H,
      v: 300 + Math.random() * 500,
      a: 0.05 + Math.random() * 0.12,
    }))
  }

  private die(): void {
    if (this.phase !== 'playing') return
    this.phase = 'over'
    this.deathAt = performance.now()
    this.hitStopUntil = performance.now() + 110
    this.addTrauma(1)
    this.flash = 0.55
    this.flashColor = this.pal.danger
    this.burst(this.shipX(), this.sy, 34, [this.pal.accent.main, this.pal.danger, this.pal.pop, '#ffb020'], 380, 4)
    this.addPop(this.shipX(), this.sy - 30, 'WRECKED', this.pal.danger, 22)
    this.audio.die()
    this.pad.rumble(1, 0.7, 300)
    this.emit({ type: 'phase', phase: 'over' })
    this.emit({
      type: 'gameover',
      stats: {
        score: this.score,
        distance: this.meters(),
        orbs: this.orbs,
        nearMisses: this.nearMisses,
      },
    })
  }

  // ------------------------------------------------------------- update

  private update(dt: number, now: number): void {
    this.padSnap = this.pad.poll()
    const snap = this.padSnap
    if (this.phase !== 'playing' && (snap.a || snap.start)) {
      this.emit({ type: 'padstart' })
    }

    // ---- thrust state ---------------------------------------------------
    this.thrustHeld =
      this.phase === 'playing' && (this.keyHeld || this.pointerHeld || !!snap.fire)
    if (this.thrustHeld) this.audio.thrust()

    // ---- attract mode: gentle sine flight --------------------------------
    if (this.phase === 'idle') {
      this.sy = this.H / 2 + Math.sin(now / 900) * this.H * 0.18
      this.shipTilt = Math.cos(now / 900) * 0.2
    }

    // ---- ship physics (playing only) ------------------------------------
    if (this.phase === 'playing') {
      const a = this.thrustHeld ? THRUST_A : GRAVITY_A
      this.vy = clamp(this.vy + a * dt, -VY_MAX, VY_MAX)
      this.sy += this.vy * dt
      this.shipTilt = clamp(this.vy / VY_MAX, -1, 1) * 0.45

      // hazard walls
      if (this.sy - SHIP_R <= 0 || this.sy + SHIP_R >= this.H) {
        this.die()
      }
    }

    // ---- world scroll ----------------------------------------------------
    if (this.phase === 'over') {
      // world drifts to a stop
      this.worldSpeed = Math.max(0, this.worldSpeed - 600 * dt)
    }
    const scroll = this.worldSpeed * dt
    this.camX += scroll
    if (this.phase === 'playing') {
      this.distPx += scroll
      this.worldSpeed = Math.min(560, this.worldSpeed + 9 * dt)
      this.score += scroll * 0.1
    }

    // spawn ahead
    while (this.nextSpawnAt < this.camX + this.W + 400) {
      this.spawnPattern()
    }

    // ---- obstacles -------------------------------------------------------
    const sx = this.shipX()
    for (const o of this.obstacles) {
      const relX = o.x - this.camX
      if (o.kind === 'block') {
        o.rot += o.vrot * dt
        o.y += o.drift * dt
        if (o.y < o.s + 8 || o.y > this.H - o.s - 8) o.drift *= -1
      }

      if (this.phase === 'playing') {
        // collision + near-miss (circle vs AABB approximation)
        const rect =
          o.kind === 'gate'
            ? { x: relX, y: 0, w: o.w, h: Math.max(0, o.gapY - o.gapH / 2) } // top pillar
            : { x: relX - o.s, y: o.y - o.s, w: o.s * 2, h: o.s * 2 }
        const rect2 =
          o.kind === 'gate'
            ? { x: relX, y: o.gapY + o.gapH / 2, w: o.w, h: this.H - (o.gapY + o.gapH / 2) }
            : null

        const dTop = circleRectDist(sx, this.sy, rect.x, rect.y, rect.w, rect.h)
        const dBot = rect2 ? circleRectDist(sx, this.sy, rect2.x, rect2.y, rect2.w, rect2.h) : Infinity

        const minD = Math.min(dTop, dBot) - SHIP_R
        if (minD <= 0) {
          this.die()
        } else if (minD < o.minClear) {
          o.minClear = minD
        }

        // near-miss award once the obstacle passes the ship
        if (!o.passed && relX + (o.kind === 'gate' ? o.w : o.s * 2) < sx - SHIP_R) {
          o.passed = true
          if (!o.nearAwarded && o.minClear <= NEAR_MISS_PX) {
            o.nearAwarded = true
            this.nearMisses++
            this.score += 25
            this.addPop(sx + 10, this.sy - 26, 'CLOSE +25', this.pal.accent.hot, 13)
            this.addTrauma(0.1)
            this.audio.close()
          }
        }
      }
    }
    // cull behind
    this.obstacles = this.obstacles.filter((o) => o.x - this.camX > -220)
    this.orbList = this.orbList.filter((o) => o.x - this.camX > -60)

    // ---- orbs ------------------------------------------------------------
    for (const orb of this.orbList) {
      orb.pulse += dt * 5
      if (this.phase !== 'playing' || orb.taken) continue
      const d = Math.hypot(orb.x - this.camX - sx, orb.y - this.sy)
      if (d < SHIP_R + orb.r) {
        orb.taken = true
        this.orbs++
        this.score += 40
        this.addPop(sx + 14, this.sy - 20, '+40', this.pal.good, 14)
        this.burst(orb.x - this.camX, orb.y, 8, [this.pal.good, this.pal.pop], 180, 2.4)
        this.audio.orb()
      }
    }

    // ---- milestones --------------------------------------------------------
    if (this.phase === 'playing' && this.meters() >= this.nextMilestone) {
      this.addPop(this.W / 2, this.H * 0.3, `${this.nextMilestone}m — FASTER`, this.pal.accent.main, 20)
      this.audio.milestone()
      this.addTrauma(0.18)
      this.bgPulse = 1
      this.nextMilestone += 500
    }

    // ---- exhaust -----------------------------------------------------------
    if (this.thrustHeld && this.phase === 'playing') {
      for (let i = 0; i < 2; i++) {
        this.particles.push({
          x: sx - 10 + (Math.random() - 0.5) * 6,
          y: this.sy + 6 + (Math.random() - 0.5) * 6,
          vx: -140 - Math.random() * 80 - this.worldSpeed * 0.3,
          vy: 60 + Math.random() * 140,
          life: 0.22 + Math.random() * 0.2,
          maxLife: 0.42,
          size: 2 + Math.random() * 3,
          color: Math.random() < 0.6 ? '#ffb020' : '#ff5c5c',
        })
      }
    }

    // ---- fx decay -----------------------------------------------------------
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt)
    this.shakeT += dt * 30
    this.flash = Math.max(0, this.flash - dt * 2.2)
    this.bgPulse = Math.max(0, this.bgPulse - dt * 1.4)

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt - scroll
      p.y += p.vy * dt
      if (p.spin) p.rot = (p.rot ?? 0) + p.spin * dt
      p.life -= dt
      if (p.life <= 0) this.particles.splice(i, 1)
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.y -= 42 * dt
      p.x -= scroll * 0.4
      p.life -= dt * 1.1
      if (p.life <= 0) this.pops.splice(i, 1)
    }
    for (const s of this.streaks) {
      s.x -= (s.v + this.worldSpeed) * dt
      if (s.x < -30) {
        s.x = this.W + 30
        s.y = Math.random() * this.H
      }
    }

    // score event (throttled by rAF; page state updates are cheap)
    if (this.phase === 'playing') {
      this.emit({ type: 'score', score: Math.floor(this.score), distance: this.meters() })
    }
  }

  // ------------------------------------------------------------- render

  private render(now: number): void {
    const ctx = this.ctx
    const p = this.pal
    const shake = this.trauma * this.trauma

    ctx.save()
    ctx.translate(
      15 * shake * Math.sin(this.shakeT * 1.7),
      10 * shake * Math.sin(this.shakeT * 2.3),
    )

    // bg
    ctx.fillStyle = p.bg
    ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
    if (this.bgPulse > 0) {
      ctx.globalAlpha = this.bgPulse * 0.08
      ctx.fillStyle = p.accent.main
      ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
      ctx.globalAlpha = 1
    }

    // speed streaks
    for (const s of this.streaks) {
      ctx.globalAlpha = s.a
      ctx.strokeStyle = p.ink
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x + 26 + this.worldSpeed * 0.05, s.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // hazard walls (top + bottom)
    const wallH = 10
    ctx.fillStyle = p.danger
    ctx.fillRect(-24, -12, this.W + 48, wallH)
    ctx.fillRect(-24, this.H - wallH + 2, this.W + 48, wallH)
    // hazard stripes
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = p.pop
    ctx.lineWidth = 3
    for (let x = -24; x < this.W + 48; x += 18) {
      ctx.beginPath()
      ctx.moveTo(x, -12)
      ctx.lineTo(x + 10, wallH - 2)
      ctx.moveTo(x, this.H - wallH + 2)
      ctx.lineTo(x + 10, this.H + 2)
      ctx.stroke()
    }
    ctx.restore()

    // ---- obstacles ---------------------------------------------------------
    for (const o of this.obstacles) {
      const relX = o.x - this.camX
      if (relX > this.W + 60 || relX < -160) continue

      if (o.kind === 'gate') {
        const topH = Math.max(0, o.gapY - o.gapH / 2)
        const botY = o.gapY + o.gapH / 2
        const botH = this.H - botY
        // pillars
        ctx.fillStyle = p.raise
        ctx.fillRect(relX, 8, o.w, Math.max(0, topH - 8))
        ctx.fillRect(relX, botY, o.w, Math.max(0, botH - 8))
        ctx.strokeStyle = p.grid
        ctx.lineWidth = 1
        ctx.strokeRect(relX, 8, o.w, Math.max(0, topH - 8))
        ctx.strokeRect(relX, botY, o.w, Math.max(0, botH - 8))
        // gap edge highlights — where you want to be
        ctx.fillStyle = p.accent.main
        ctx.fillRect(relX, topH - 3, o.w, 3)
        ctx.fillRect(relX, botY, o.w, 3)
        ctx.globalAlpha = 0.16
        ctx.fillRect(relX - 4, topH, o.w + 8, o.gapH)
        ctx.globalAlpha = 1
      } else {
        // drifting block
        ctx.save()
        ctx.translate(relX, o.y)
        ctx.rotate(o.rot)
        ctx.fillStyle = p.raise
        ctx.strokeStyle = p.accent.dim
        ctx.lineWidth = 2
        ctx.fillRect(-o.s, -o.s, o.s * 2, o.s * 2)
        ctx.strokeRect(-o.s, -o.s, o.s * 2, o.s * 2)
        // inner glyph
        ctx.fillStyle = p.accent.main
        ctx.fillRect(-o.s * 0.3, -o.s * 0.3, o.s * 0.6, o.s * 0.6)
        ctx.restore()
      }
    }

    // ---- orbs -----------------------------------------------------------------
    for (const orb of this.orbList) {
      if (orb.taken) continue
      const relX = orb.x - this.camX
      if (relX < -30 || relX > this.W + 30) continue
      const pulse = 1 + Math.sin(orb.pulse) * 0.18
      ctx.globalAlpha = 0.25
      ctx.fillStyle = p.good
      ctx.beginPath()
      ctx.arc(relX, orb.y, orb.r * 2.1 * pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = p.good
      ctx.beginPath()
      ctx.arc(relX, orb.y, orb.r * pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = p.pop
      ctx.beginPath()
      ctx.arc(relX - 2, orb.y - 2, orb.r * 0.32, 0, Math.PI * 2)
      ctx.fill()
    }

    // ---- ship ------------------------------------------------------------------
    const sx = this.shipX()
    if (this.phase !== 'over') {
      ctx.save()
      ctx.translate(sx, this.sy)
      ctx.rotate(this.shipTilt)
      // engine glow
      if (this.thrustHeld) {
        ctx.globalAlpha = 0.5
        ctx.fillStyle = '#ffb020'
        ctx.beginPath()
        ctx.moveTo(-12, -5)
        ctx.lineTo(-26 - Math.random() * 10, 0)
        ctx.lineTo(-12, 5)
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
      }
      // hull
      ctx.fillStyle = p.pop
      ctx.beginPath()
      ctx.moveTo(18, 0)
      ctx.lineTo(-10, -11)
      ctx.lineTo(-5, 0)
      ctx.lineTo(-10, 11)
      ctx.closePath()
      ctx.fill()
      // canopy
      ctx.fillStyle = p.accent.main
      ctx.beginPath()
      ctx.arc(2, -1, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // ---- particles -----------------------------------------------------------------
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife)
      ctx.fillStyle = pt.color
      if (pt.rot !== undefined) {
        ctx.save()
        ctx.translate(pt.x, pt.y)
        ctx.rotate(pt.rot)
        ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size)
        ctx.restore()
      } else {
        ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size)
      }
    }
    ctx.globalAlpha = 1

    // ---- pops -------------------------------------------------------------------------
    ctx.textAlign = 'center'
    for (const pp of this.pops) {
      ctx.globalAlpha = Math.min(1, pp.life * 1.6)
      ctx.font = `900 ${pp.size}px ui-monospace, monospace`
      ctx.fillStyle = pp.color
      ctx.fillText(pp.text, pp.x, pp.y)
    }
    ctx.globalAlpha = 1

    // ---- flash ------------------------------------------------------------------------
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.6, this.flash)
      ctx.fillStyle = this.flashColor
      ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
      ctx.globalAlpha = 1
    }

    ctx.restore()

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
    let dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now

    if (now < this.hitStopUntil) dt *= 0.05
    if (this.phase === 'over' && now - this.deathAt < 900) dt *= 0.25

    this.update(dt, now)
    this.render(now)
    this.raf = requestAnimationFrame(this.loop)
  }
}

// ------------------------------------------------------------------ utils

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** distance from a circle center to the closest point on a rect (0 = inside) */
function circleRectDist(cx: number, cy: number, rx: number, ry: number, rw: number, rh: number): number {
  const nx = clamp(cx, rx, rx + rw)
  const ny = clamp(cy, ry, ry + rh)
  return Math.hypot(cx - nx, cy - ny)
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}
