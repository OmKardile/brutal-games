// BRUTAL // REFLEX — the timing strike.
//
// A blade sweeps across the strike track. Tap when it's inside the zone.
//   PERFECT (dead center)  -> streak up, chime climbs, zone REGROWS
//   GOOD   (inside, loose) -> stays alive, zone shrinks harder
//   MISS   (tap outside / blade passes through) -> run over, slow-mo death
// One input. Runs last 30-90 seconds. Instant retry.
//
// Juice (game-feel tiers): trauma-based screen shake (trauma^2, smooth sin
// noise, decays to rest), hit-stop on perfects (real-time restore), eased
// score pops, ring bursts, pentatonic streak ladder, red flash + slow-mo on
// death. The menu runs an attract-mode demo of the same track.
//
// The engine owns the canvas only. Menus / HUD / leaderboard live in the page
// (src/app/reflex/page.tsx) and receive events through the callback.

import { GamepadReader, type PadSnapshot } from './gamepad'
import { paletteFor, type GamePalette, type GameThemeMode } from './theme'

export type ReflexPhase = 'idle' | 'playing' | 'over'

export interface ReflexStats {
  score: number
  hits: number
  perfects: number
  bestStreak: number
}

export type ReflexEvent =
  | { type: 'phase'; phase: ReflexPhase }
  | { type: 'hit'; kind: 'perfect' | 'good'; score: number; streak: number }
  | { type: 'gameover'; stats: ReflexStats }
  | { type: 'padstart' } // gamepad confirm on menu / game-over overlay

// ------------------------------------------------------------------ audio

class ReflexAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
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

  good(): void {
    this.tone(340, 240, 0.07, 'square', 0.16)
    this.noise(0.04, 0.08, 2600)
  }

  // pentatonic ladder — climbs with the streak, the dopamine hook
  perfect(streak: number): void {
    const ladder = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 2093]
    const i = Math.min(streak - 1, ladder.length - 1)
    this.tone(ladder[i], ladder[i], 0.16, 'triangle', 0.24)
    this.tone(ladder[i] * 2, ladder[i] * 2, 0.08, 'square', 0.06, 0.02)
    if (streak >= 3) this.tone(ladder[i] * 1.5, ladder[i] * 1.5, 0.1, 'triangle', 0.1, 0.05)
  }

  milestone(): void {
    this.tone(523.25, 523.25, 0.16, 'triangle', 0.16)
    this.tone(659.25, 659.25, 0.16, 'triangle', 0.14, 0.06)
    this.tone(1046.5, 1046.5, 0.26, 'triangle', 0.14, 0.12)
  }

  miss(): void {
    this.tone(220, 46, 0.55, 'sawtooth', 0.24)
    this.noise(0.4, 0.18, 420)
  }

  strikeTick(): void {
    this.tone(160, 120, 0.04, 'square', 0.07)
  }
}

// ------------------------------------------------------------------ types

interface Spark {
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
  maxLife: number
  size: number
}

// ------------------------------------------------------------------ engine

const TRAUMA_DECAY = 1.25 // per second
const SHAKE_MAX_X = 14
const SHAKE_MAX_Y = 9
const HITSTOP_MS = 70 // perfects only
const DEATH_SLOW = 0.22
const DEATH_SLOW_MS = 950

export class ReflexGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private emit: (ev: ReflexEvent) => void
  private audio = new ReflexAudio()

  private raf = 0
  private lastT = 0
  private dead = false
  private pad = new GamepadReader()
  private padSnap: PadSnapshot | null = null

  private pal: GamePalette = paletteFor('reflex', 'night')

  // layout (css px)
  private W = 0
  private H = 0
  private dpr = 1

  // run state
  private phase: ReflexPhase = 'idle'
  private score = 0
  private hits = 0
  private perfects = 0
  private streak = 0
  private bestStreak = 0
  private lastStrikeAt = 0 // double-fire guard

  // track
  private trackY = 0
  private trackH = 72
  private padX = 0 // track padding
  private span = 0 // usable track width

  // blade (marker)
  private bx = 0
  private bdir: 1 | -1 = 1
  private trail: { x: number; a: number }[] = []
  private bladeFlash = 0

  // zone
  private zc = 0 // center
  private zh = 0 // half width
  private zonePulse = 0
  private enteredZone = false

  // death / timing
  private deathAt = 0
  private hitStopUntil = 0

  // fx
  private trauma = 0
  private shakeT = 0
  private sparks: Spark[] = []
  private rings: Ring[] = []
  private pops: Pop[] = []
  private flash = 0
  private flashColor = '#ffffff'
  private bgPulse = 0
  private dust: { x: number; y: number; v: number; a: number; s: number }[] = []

  constructor(canvas: HTMLCanvasElement, emit: (ev: ReflexEvent) => void) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    this.ctx = ctx
    this.emit = emit

    this.resize()
    this.resetTrack()
    this.seedDust()

    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('resize', this.onResize)

    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.pad.destroy()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('resize', this.onResize)
  }

  setMuted(m: boolean): void {
    this.audio.muted = m
  }

  setTheme(mode: GameThemeMode): void {
    this.pal = paletteFor('reflex', mode)
  }

  start(): void {
    this.audio.ensure()
    this.score = 0
    this.hits = 0
    this.perfects = 0
    this.streak = 0
    this.bestStreak = 0
    this.goodShrink = 0
    this.sparks.length = 0
    this.rings.length = 0
    this.pops.length = 0
    this.trail.length = 0
    this.trauma = 0
    this.flash = 0
    this.resetTrack()
    this.phase = 'playing'
    this.emit({ type: 'phase', phase: 'playing' })
  }

  // ------------------------------------------------------------- internal

  private resetTrack(): void {
    this.trackY = this.H * 0.54
    this.padX = Math.max(34, this.W * 0.09)
    this.span = this.W - this.padX * 2
    this.bx = this.padX
    this.bdir = 1
    this.zh = this.span * 0.13
    this.zc = this.pickZoneCenter()
    this.enteredZone = false
  }

  /** zone never spawns right on top of the blade — no free hits */
  private pickZoneCenter(): number {
    for (let i = 0; i < 24; i++) {
      const c = this.padX + this.zh + Math.random() * (this.span - this.zh * 2)
      if (Math.abs(c - this.bx) > this.span * 0.28) return c
    }
    return this.padX + this.span * 0.5
  }

  private bladeSpeed(): number {
    // relative to track width so every screen size plays the same
    const t = this.hits * 0.014
    return this.span * (0.52 + Math.min(t, 0.85))
  }

  private goodShrink = 0

  private zoneHalf(): number {
    // shrinks with good hits, regrows on perfect streaks
    const base = this.span * 0.13
    const shrink = this.goodShrink * this.span * 0.008
    return Math.max(this.span * 0.042, base - shrink)
  }

  private onResize = (): void => {
    this.resize()
    this.trackY = this.H * 0.54
    this.padX = Math.max(34, this.W * 0.09)
    this.span = this.W - this.padX * 2
    this.zc = Math.min(Math.max(this.zc, this.padX + this.zh), this.W - this.padX - this.zh)
    this.bx = Math.min(Math.max(this.bx, this.padX), this.W - this.padX)
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

  private seedDust(): void {
    this.dust = Array.from({ length: 26 }, () => ({
      x: Math.random() * this.W,
      y: Math.random() * this.H,
      v: 6 + Math.random() * 22,
      a: 0.04 + Math.random() * 0.1,
      s: Math.random() < 0.5 ? 1 : 2,
    }))
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    this.audio.ensure()
    if (this.phase === 'playing') this.strike()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    if (e.code !== 'Space' && e.code !== 'Enter') return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) {
      return
    }
    e.preventDefault()
    this.audio.ensure()
    if (this.phase === 'playing') this.strike()
  }

  /** the one verb */
  private strike(): void {
    const now = performance.now()
    if (now - this.lastStrikeAt < 90) return // double-fire guard
    this.lastStrikeAt = now

    const rel = Math.abs(this.bx - this.zc)
    if (rel > this.zh) {
      this.fail('EARLY')
      return
    }

    const perfect = rel <= this.zh * 0.34
    if (perfect) {
      this.streak++
      this.perfects++
      this.bestStreak = Math.max(this.bestStreak, this.streak)
      const pts = 100 + (this.streak - 1) * 20
      this.score += pts
      this.goodShrink = Math.max(0, this.goodShrink - 1.4) // the comeback mechanic
      this.hitStopUntil = now + HITSTOP_MS
      this.addTrauma(0.38)
      this.bladeFlash = 1
      this.flash = 0.16
      this.flashColor = this.pal.accent.hot
      this.spawnSparks(this.bx, this.trackY, 14)
      this.rings.push({ x: this.bx, y: this.trackY, r: 8, life: 1, color: this.pal.accent.main })
      this.addPop(this.bx, this.trackY - this.trackH, `PERFECT +${pts}`, this.pal.accent.hot, 16)
      this.audio.perfect(this.streak)
      this.emit({ type: 'hit', kind: 'perfect', score: this.score, streak: this.streak })
    } else {
      this.streak = 0
      const pts = 40
      this.score += pts
      this.goodShrink += 1
      this.addTrauma(0.14)
      this.spawnSparks(this.bx, this.trackY, 6)
      this.addPop(this.bx, this.trackY - this.trackH, `+${pts}`, this.pal.inkDim, 13)
      this.audio.good()
      this.emit({ type: 'hit', kind: 'good', score: this.score, streak: this.streak })
    }

    this.hits++
    this.zonePulse = 1
    if (this.hits % 10 === 0) {
      this.audio.milestone()
      this.addTrauma(0.22)
      this.bgPulse = 1
      this.addPop(this.W / 2, this.trackY - this.trackH * 2.6, `${this.hits} HITS`, this.pal.accent.main, 20)
    }

    // next round: zone relocates, keeps shrinking
    this.zh = this.zoneHalf()
    this.zc = this.pickZoneCenter()
    this.enteredZone = false
  }

  private fail(reason: string): void {
    if (this.phase !== 'playing') return
    this.phase = 'over'
    this.deathAt = performance.now()
    this.hitStopUntil = 0
    this.addTrauma(1)
    this.flash = 0.5
    this.flashColor = this.pal.danger
    this.spawnSparks(this.bx, this.trackY, 26, this.pal.danger)
    this.addPop(this.bx, this.trackY - this.trackH * 1.4, reason, this.pal.danger, 22)
    this.audio.miss()
    this.pad.rumble(1, 0.6, 260)
    this.emit({ type: 'phase', phase: 'over' })
    this.emit({ type: 'gameover', stats: this.finalStats() })
  }

  private finalStats(): ReflexStats {
    return {
      score: this.score,
      hits: this.hits,
      perfects: this.perfects,
      bestStreak: this.bestStreak,
    }
  }

  private addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a)
  }

  private spawnSparks(x: number, y: number, n: number, color?: string): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2
      const sp = 120 + Math.random() * 260
      this.sparks.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp * 0.7,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        size: 1 + Math.random() * 2.6,
        color: color ?? (Math.random() < 0.5 ? this.pal.accent.main : this.pal.pop),
      })
    }
  }

  private addPop(x: number, y: number, text: string, color: string, size: number): void {
    this.pops.push({ x, y, text, color, life: 1, maxLife: 1, size })
  }

  // --------------------------------------------------------------- update

  private update(dt: number, now: number): void {
    // ---- gamepad --------------------------------------------------------
    this.padSnap = this.pad.poll()
    const snap = this.padSnap
    if (this.phase === 'playing' && (snap.a || snap.rt || snap.x)) {
      this.audio.ensure()
      this.strike()
    } else if (this.phase !== 'playing' && (snap.a || snap.start)) {
      this.emit({ type: 'padstart' })
    }

    // ---- blade ----------------------------------------------------------
    if (this.phase === 'playing' || this.phase === 'idle') {
      const speed = this.phase === 'idle' ? this.span * 0.42 : this.bladeSpeed()

      this.bx += this.bdir * speed * dt
      if (this.bx >= this.W - this.padX) {
        this.bx = this.W - this.padX
        this.bdir = -1
      } else if (this.bx <= this.padX) {
        this.bx = this.padX
        this.bdir = 1
      }

      // trail (fading history)
      this.trail.unshift({ x: this.bx, a: 1 })
      if (this.trail.length > 12) this.trail.pop()

      // pass-through miss detection (playing only; attract mode just relocates)
      const inside = Math.abs(this.bx - this.zc) <= this.zh
      if (inside) {
        this.enteredZone = true
      } else if (this.enteredZone) {
        this.enteredZone = false
        if (this.phase === 'playing') {
          this.fail('LATE')
        } else {
          this.zc = this.pickZoneCenter()
        }
      }
      if (this.phase === 'idle' && Math.random() < dt * 0.4) {
        this.zc = this.pickZoneCenter()
      }
    }

    // ---- fx decay -------------------------------------------------------
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt)
    this.shakeT += dt * 30
    this.zonePulse = Math.max(0, this.zonePulse - dt * 3)
    this.bladeFlash = Math.max(0, this.bladeFlash - dt * 6)
    this.flash = Math.max(0, this.flash - dt * 2.2)
    this.bgPulse = Math.max(0, this.bgPulse - dt * 1.4)

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vx *= 1 - 2.4 * dt
      s.vy += 420 * dt
      s.life -= dt
      if (s.life <= 0) this.sparks.splice(i, 1)
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.r += 340 * dt
      r.life -= dt * 2.2
      if (r.life <= 0) this.rings.splice(i, 1)
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.y -= 46 * dt
      p.life -= dt * 1.1
      if (p.life <= 0) this.pops.splice(i, 1)
    }
    for (const d of this.dust) {
      d.x -= d.v * dt
      if (d.x < -4) {
        d.x = this.W + 4
        d.y = Math.random() * this.H
      }
    }
  }

  // --------------------------------------------------------------- render

  private render(now: number): void {
    const ctx = this.ctx
    const p = this.pal
    const shake = this.trauma * this.trauma

    ctx.save()
    // trauma shake — visual offset only, never the simulation
    ctx.translate(
      SHAKE_MAX_X * shake * Math.sin(this.shakeT * 1.7),
      SHAKE_MAX_Y * shake * Math.sin(this.shakeT * 2.3),
    )

    // bg
    ctx.fillStyle = p.bg
    ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
    if (this.bgPulse > 0) {
      ctx.globalAlpha = this.bgPulse * 0.1
      ctx.fillStyle = p.accent.main
      ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
      ctx.globalAlpha = 1
    }

    // vertical hairlines
    ctx.strokeStyle = p.grid
    ctx.lineWidth = 1
    const cols = 9
    for (let i = 1; i < cols; i++) {
      const x = (this.W / cols) * i
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.H)
      ctx.stroke()
    }

    // dust
    for (const d of this.dust) {
      ctx.globalAlpha = d.a
      ctx.fillStyle = p.ink
      ctx.fillRect(d.x, d.y, d.s, d.s)
    }
    ctx.globalAlpha = 1

    // ---- strike track ---------------------------------------------------
    const ty = this.trackY - this.trackH / 2
    ctx.fillStyle = p.raise
    ctx.fillRect(this.padX - 10, ty, this.span + 20, this.trackH)
    ctx.strokeStyle = p.grid
    ctx.lineWidth = 1
    ctx.strokeRect(this.padX - 10, ty, this.span + 20, this.trackH)

    // tick marks
    ctx.strokeStyle = p.grid
    for (let i = 0; i <= 16; i++) {
      const x = this.padX + (this.span / 16) * i
      const h = i % 4 === 0 ? 12 : 6
      ctx.beginPath()
      ctx.moveTo(x, ty + this.trackH - h)
      ctx.lineTo(x, ty + this.trackH)
      ctx.stroke()
    }

    // ---- zone -----------------------------------------------------------
    const zh = this.zh * (1 + this.zonePulse * 0.08)
    const zx = this.zc - zh
    const grad = ctx.createLinearGradient(zx, 0, zx + zh * 2, 0)
    grad.addColorStop(0, this.hexA(p.accent.main, 0.14))
    grad.addColorStop(0.5, this.hexA(p.accent.main, 0.34))
    grad.addColorStop(1, this.hexA(p.accent.main, 0.14))
    ctx.fillStyle = grad
    ctx.fillRect(zx, ty + 3, zh * 2, this.trackH - 6)
    // zone edges
    ctx.fillStyle = p.accent.main
    ctx.fillRect(zx - 2, ty - 6, 3, this.trackH + 12)
    ctx.fillRect(zx + zh * 2 - 1, ty - 6, 3, this.trackH + 12)
    // center notch — the perfect line
    ctx.fillStyle = p.pop
    ctx.fillRect(this.zc - 1, ty - 10, 2, this.trackH + 20)
    // perfect band hint
    ctx.fillStyle = this.hexA(p.accent.hot, 0.22)
    ctx.fillRect(this.zc - zh * 0.34, ty + 3, zh * 0.68, this.trackH - 6)

    // ---- blade trail + blade -------------------------------------------
    for (let i = this.trail.length - 1; i >= 1; i--) {
      const t = this.trail[i]
      const a = (1 - i / this.trail.length) * 0.24
      ctx.globalAlpha = a
      ctx.fillStyle = p.accent.main
      ctx.fillRect(t.x - 2, ty - 4, 4, this.trackH + 8)
    }
    ctx.globalAlpha = 1

    // blade
    const bx = this.bx
    ctx.fillStyle = p.accent.main
    ctx.fillRect(bx - 3, ty - 8, 6, this.trackH + 16)
    ctx.fillStyle = this.bladeFlash > 0 ? p.pop : p.ink
    ctx.fillRect(bx - 1, ty - 10, 2, this.trackH + 20)
    if (this.bladeFlash > 0 || this.phase === 'playing') {
      ctx.globalAlpha = 0.35 + this.bladeFlash * 0.4
      ctx.shadowColor = p.accent.main
      ctx.shadowBlur = 18
      ctx.fillStyle = p.accent.main
      ctx.fillRect(bx - 2, ty - 6, 4, this.trackH + 12)
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }

    // ---- particles ------------------------------------------------------
    for (const s of this.sparks) {
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife)
      ctx.fillStyle = s.color
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size)
    }
    ctx.globalAlpha = 1

    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.8
      ctx.strokeStyle = r.color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // ---- pops -----------------------------------------------------------
    ctx.textAlign = 'center'
    for (const pp of this.pops) {
      const t = pp.life / pp.maxLife
      ctx.globalAlpha = Math.min(1, t * 1.6)
      ctx.font = `900 ${pp.size}px ${'ui-monospace, monospace'}`
      ctx.fillStyle = pp.color
      ctx.fillText(pp.text, pp.x, pp.y)
    }
    ctx.globalAlpha = 1

    // ---- flash ----------------------------------------------------------
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.6, this.flash)
      ctx.fillStyle = this.flashColor
      ctx.fillRect(-24, -24, this.W + 48, this.H + 48)
      ctx.globalAlpha = 1
    }

    // vignette
    const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.3, this.W / 2, this.H / 2, this.H * 0.85)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, p.theme === 'night' ? 'rgba(0,0,0,0.5)' : 'rgba(54,42,26,0.18)')
    ctx.fillStyle = vg
    ctx.fillRect(-24, -24, this.W + 48, this.H + 48)

    ctx.restore()

    // death dim (outside shake so it stays put)
    if (this.phase === 'over') {
      const t = Math.min(1, (now - this.deathAt) / 500)
      ctx.fillStyle = this.hexA(this.pal.bg, 0.35 * t)
      ctx.fillRect(0, 0, this.W, this.H)
    }
  }

  private hexA(hex: string, a: number): string {
    const h = hex.replace('#', '')
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return `rgba(${r},${g},${b},${a})`
  }

  // --------------------------------------------------------------- loop

  private loop = (now: number): void => {
    if (this.dead) return
    let dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now

    // hit-stop: near-freeze sim time, restored by wall-clock expiry
    if (now < this.hitStopUntil) dt *= 0.05
    // death slow-mo: brief, then the overlay takes over
    if (this.phase === 'over' && now - this.deathAt < DEATH_SLOW_MS) dt *= DEATH_SLOW

    this.update(dt, now)
    this.render(now)
    this.raf = requestAnimationFrame(this.loop)
  }
}
