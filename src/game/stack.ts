// BRUTAL // STACK — one-tap isometric tower stacker.
//
// A block slides back and forth above the tower. Tap / click / space to drop
// it. Whatever hangs over the edge is sliced off and falls — the tower keeps
// shrinking. Land a PERFECT drop (within tolerance) and the streak builds:
//   streak >= 3  -> the block REGROWS (+width), the comeback mechanic
//   every streak -> the perfect chime climbs a pentatonic ladder
// Miss the tower entirely and the run ends. Score = blocks stacked.
//
// The engine owns the canvas only. Menus / HUD / leaderboard live in the page
// (src/app/stack/page.tsx) and receive events through the callback.

export type StackPhase = 'idle' | 'playing' | 'over'

export interface StackStats {
  score: number
  perfects: number
  bestStreak: number
}

export type StackEvent =
  | { type: 'phase'; phase: StackPhase }
  | { type: 'drop'; score: number; streak: number }
  | { type: 'gameover'; stats: StackStats }

interface Block {
  x: number // center, world px
  z: number
  w: number // extent along X
  d: number // extent along Z
  hue: number
  flash: number // 1 -> 0 white overlay decay
}

interface Piece {
  // falling debris (sliced overhangs, death chunks). y = TOP face world y.
  x: number
  z: number
  w: number
  d: number
  y: number
  vy: number // world-y velocity (negative = moving up)
  vx: number
  vz: number
  hue: number
  alpha: number
  life: number
}

interface Particle {
  // screen-space sparks
  sx: number
  sy: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
}

interface Popup {
  // screen-space floating text
  sx: number
  sy: number
  text: string
  color: string
  life: number
  maxLife: number
  size: number
}

interface Ring {
  // perfect-drop pulse, anchored to a block top face
  x: number
  z: number
  w: number
  d: number
  y: number
  life: number
}

// ------------------------------------------------------------------ audio

class StackAudio {
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

  private tone(
    freq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
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
    this.tone(170, 110, 0.07, 'square', 0.16)
  }

  slice(): void {
    this.noise(0.09, 0.14, 900)
  }

  // rising pentatonic ladder — the dopamine hook
  perfect(streak: number): void {
    const ladder = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51]
    const i = Math.min(streak - 1, ladder.length - 1)
    this.tone(ladder[i], ladder[i], 0.14, 'triangle', 0.22)
    if (streak >= 2) this.tone(ladder[i] * 1.5, ladder[i] * 1.5, 0.1, 'triangle', 0.08, 0.03)
  }

  grow(): void {
    this.tone(440, 440, 0.07, 'triangle', 0.14)
    this.tone(660, 660, 0.09, 'triangle', 0.14, 0.07)
  }

  milestone(): void {
    this.tone(392, 392, 0.22, 'triangle', 0.12)
    this.tone(587.33, 587.33, 0.22, 'triangle', 0.1, 0.05)
    this.tone(783.99, 783.99, 0.3, 'triangle', 0.1, 0.1)
  }

  over(): void {
    this.tone(220, 55, 0.5, 'sawtooth', 0.2)
    this.noise(0.35, 0.16, 500)
  }
}

// ------------------------------------------------------------------ engine

const BG = '#070709'
const BLOCK_H_RATIO = 0.24 // block height relative to base size

export class StackGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private emit: (ev: StackEvent) => void
  private audio = new StackAudio()

  private raf = 0
  private lastT = 0
  private dead = false

  // layout (px, css units)
  private W = 0
  private H = 0
  private cx = 0
  private cy = 0
  private S = 150 // base block size
  private BH = 36 // block height

  // run state
  private phase: StackPhase = 'idle'
  private blocks: Block[] = []
  private pieces: Piece[] = []
  private particles: Particle[] = []
  private popups: Popup[] = []
  private rings: Ring[] = []
  private topY = 0 // world y of the tower's top surface
  private camY = 0
  private camTarget = 0
  private score = 0
  private streak = 0
  private bestStreak = 0
  private perfects = 0
  private lastDropAt = 0 // guards double-fire (touch + click)

  // slider
  private axis: 'x' | 'z' = 'x'
  private slidePos = 0
  private slideDir: 1 | -1 = 1
  private slideSpeed = 0
  private range = 200

  // fx
  private shakeT = 0
  private shakeMag = 0
  private bgPulse = 0
  private dust: { x: number; y: number; v: number; a: number; s: number }[] = []

  constructor(canvas: HTMLCanvasElement, emit: (ev: StackEvent) => void) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    this.ctx = ctx
    this.emit = emit

    this.resize()
    this.resetTower()
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
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('resize', this.onResize)
  }

  setMuted(m: boolean): void {
    this.audio.muted = m
  }

  /** Begin (or restart) a run. */
  start(): void {
    this.audio.ensure()
    this.resetTower()
    this.phase = 'playing'
    this.spawnSlider()
    this.emit({ type: 'phase', phase: 'playing' })
  }

  // ---------------------------------------------------------------- input

  private onResize = (): void => this.resize()

  private onPointerDown = (e: PointerEvent): void => {
    this.audio.ensure()
    if (this.phase !== 'playing') return
    e.preventDefault()
    this.tryDrop()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'ArrowDown') return
    if (this.phase !== 'playing') return
    e.preventDefault()
    this.audio.ensure()
    this.tryDrop()
  }

  private tryDrop(): void {
    const now = performance.now()
    if (now - this.lastDropAt < 90) return
    this.lastDropAt = now
    this.dropBlock()
  }

  // ---------------------------------------------------------------- state

  private resetTower(): void {
    this.blocks = [{ x: 0, z: 0, w: this.S, d: this.S, hue: 12, flash: 0 }]
    this.pieces = []
    this.particles = []
    this.popups = []
    this.rings = []
    this.topY = this.BH // top surface of the base block
    this.camY = this.BH
    this.camTarget = this.BH
    this.score = 0
    this.streak = 0
    this.bestStreak = 0
    this.perfects = 0
    this.shakeT = 0
    this.bgPulse = 0
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.W = Math.max(1, rect.width)
    this.H = Math.max(1, rect.height)
    this.canvas.width = Math.floor(this.W * dpr)
    this.canvas.height = Math.floor(this.H * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.cx = this.W / 2
    this.cy = this.H * 0.42
    // base size scales with viewport, clamped so phones and desktops both feel right
    this.S = Math.round(Math.min(Math.max(Math.min(this.W, this.H) * 0.3, 96), 170))
    this.BH = this.S * BLOCK_H_RATIO
    this.range = this.S * 1.35
  }

  private seedDust(): void {
    this.dust = []
    for (let i = 0; i < 26; i++) {
      this.dust.push({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        v: 4 + Math.random() * 14,
        a: 0.03 + Math.random() * 0.09,
        s: 0.6 + Math.random() * 1.6,
      })
    }
  }

  private blockHue(i: number): number {
    // slow oscillation between red (8) and amber (38); full cycle ~ 140 blocks
    return 8 + 30 * (0.5 - 0.5 * Math.cos(i * 0.045))
  }

  private spawnSlider(): void {
    // alternate the slide axis each level; random starting side
    this.axis = this.blocks.length % 2 === 1 ? 'x' : 'z'
    this.slideDir = Math.random() < 0.5 ? 1 : -1
    this.slidePos = -this.range * this.slideDir
    const n = this.blocks.length
    const ramp = 0.85 + Math.min(1.0, n * 0.02) // ~2.3s per traverse early, ~1.05s late
    this.slideSpeed = (2 * this.range * ramp) / 2.0
  }

  private tolerance(): number {
    // generous early, tightens as the tower rises
    const n = this.blocks.length
    return Math.max(2.2, this.S * 0.075 * (1 - Math.min(0.6, n * 0.008)))
  }

  // ---------------------------------------------------------------- drop

  private dropBlock(): void {
    const top = this.blocks[this.blocks.length - 1]
    const axis = this.axis
    const pos = this.slidePos
    const size = axis === 'x' ? top.w : top.d
    const topPos = axis === 'x' ? top.x : top.z

    // intervals along the slide axis
    const lo = Math.max(pos - size / 2, topPos - size / 2)
    const hi = Math.min(pos + size / 2, topPos + size / 2)
    const overlap = hi - lo

    if (overlap <= 1.5) {
      this.gameOver(pos, size, axis)
      return
    }

    const perfect = Math.abs(pos - topPos) <= this.tolerance()
    let newX = top.x
    let newZ = top.z
    let newW = top.w
    let newD = top.d

    if (perfect) {
      this.streak += 1
      this.bestStreak = Math.max(this.bestStreak, this.streak)
      this.perfects += 1
      if (axis === 'x') newX = top.x
      else newZ = top.z
      // regrow comeback mechanic
      if (this.streak >= 3) {
        const before = Math.min(newW, newD)
        newW = Math.min(this.S, newW + this.S * 0.06)
        newD = Math.min(this.S, newD + this.S * 0.06)
        const after = Math.min(newW, newD)
        if (after > before + 0.5) {
          this.audio.grow()
          this.addPopup(newX, newZ, this.topY + this.BH, '+GROW', '#fbbf24', 12)
        }
      }
    } else {
      if (this.streak >= 3) {
        this.addPopup(newX, newZ, this.topY + this.BH, 'STREAK LOST', '#78716c', 10)
      }
      this.streak = 0
      if (axis === 'x') {
        newX = (lo + hi) / 2
        newW = overlap
      } else {
        newZ = (lo + hi) / 2
        newD = overlap
      }
      // sliced overhang becomes debris
      const sliceW = size - overlap
      if (sliceW > 0.75) {
        const side = pos > topPos ? 1 : -1
        const sCenter = side === 1 ? hi + sliceW / 2 : lo - sliceW / 2
        this.pieces.push({
          x: axis === 'x' ? sCenter : newX,
          z: axis === 'z' ? sCenter : newZ,
          w: axis === 'x' ? sliceW : newW,
          d: axis === 'z' ? sliceW : newD,
          y: this.topY + this.BH,
          vy: 20,
          vx: axis === 'x' ? side * (30 + Math.random() * 60) : 0,
          vz: axis === 'z' ? side * (30 + Math.random() * 60) : 0,
          hue: this.blockHue(this.blocks.length),
          alpha: 1,
          life: 1.4,
        })
        this.audio.slice()
        this.spawnSparks(
          axis === 'x' ? sCenter : newX,
          axis === 'z' ? sCenter : newZ,
          this.topY,
          12,
          '#f59e0b',
        )
      }
    }

    // place the landed block
    const hue = this.blockHue(this.blocks.length)
    this.blocks.push({ x: newX, z: newZ, w: newW, d: newD, hue, flash: perfect ? 1 : 0 })
    this.topY += this.BH
    this.score += 1

    if (perfect) {
      this.audio.perfect(this.streak)
      this.rings.push({ x: newX, z: newZ, w: newW, d: newD, y: this.topY, life: 0.5 })
      const label = this.streak >= 2 ? `PERFECT ×${this.streak}` : 'PERFECT'
      this.addPopup(newX, newZ, this.topY, label, this.streak >= 2 ? '#fbbf24' : '#fafafa', 13)
      this.spawnSparks(newX, newZ, this.topY, 8, '#fafafa')
      this.shake(0.06, 2.5)
    } else {
      this.audio.drop()
      this.shake(0.05, 2)
    }

    // milestones every 10
    if (this.score % 10 === 0) {
      this.bgPulse = 1
      this.audio.milestone()
      this.addPopup(newX, newZ, this.topY + this.BH * 0.5, `ALTITUDE ${this.score}`, '#ef4444', 16)
    }

    this.camTarget = this.topY
    this.emit({ type: 'drop', score: this.score, streak: this.streak })
    this.spawnSlider()
  }

  private gameOver(pos: number, size: number, axis: 'x' | 'z'): void {
    const top = this.blocks[this.blocks.length - 1]
    // whole slider tumbles
    this.pieces.push({
      x: axis === 'x' ? pos : top.x,
      z: axis === 'z' ? pos : top.z,
      w: axis === 'x' ? size : top.w,
      d: axis === 'z' ? size : top.d,
      y: this.topY + this.BH,
      vy: 30,
      vx: axis === 'x' ? (pos > 0 ? 90 : -90) : (Math.random() - 0.5) * 120,
      vz: axis === 'z' ? (pos > 0 ? 90 : -90) : (Math.random() - 0.5) * 120,
      hue: this.blockHue(this.blocks.length),
      alpha: 1,
      life: 1.6,
    })
    // crown of the tower crumbles
    const crown = this.blocks.splice(Math.max(1, this.blocks.length - 2))
    for (const b of crown) {
      const chunks = 2 + Math.floor(Math.random() * 2)
      for (let i = 0; i < chunks; i++) {
        this.pieces.push({
          x: b.x + (Math.random() - 0.5) * b.w * 0.4,
          z: b.z + (Math.random() - 0.5) * b.d * 0.4,
          w: b.w * (0.3 + Math.random() * 0.3),
          d: b.d * (0.3 + Math.random() * 0.3),
          y: this.topY - this.BH * Math.random(),
          vy: -60 - Math.random() * 120,
          vx: (Math.random() - 0.5) * 260,
          vz: (Math.random() - 0.5) * 260,
          hue: b.hue,
          alpha: 1,
          life: 1.5,
        })
      }
    }
    this.topY = Math.max(this.BH, this.topY - this.BH * crown.length)
    this.spawnSparks(top.x, top.z, this.topY, 34, '#ef4444')
    this.shake(0.45, 13)
    this.audio.over()
    this.phase = 'over'
    this.emit({ type: 'phase', phase: 'over' })
    this.emit({
      type: 'gameover',
      stats: {
        score: this.score,
        perfects: this.perfects,
        bestStreak: this.bestStreak,
      },
    })
  }

  // ---------------------------------------------------------------- fx

  private shake(t: number, mag: number): void {
    this.shakeT = Math.max(this.shakeT, t)
    this.shakeMag = Math.max(this.shakeMag, mag)
  }

  private addPopup(x: number, z: number, y: number, text: string, color: string, size: number): void {
    const [sx, sy] = this.project(x, z, y)
    this.popups.push({ sx, sy, text, color, life: 0.9, maxLife: 0.9, size })
  }

  private spawnSparks(x: number, z: number, y: number, n: number, color: string): void {
    const [sx, sy] = this.project(x, z, y)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 60 + Math.random() * 220
      this.particles.push({
        sx,
        sy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 60,
        life: 0.35 + Math.random() * 0.4,
        maxLife: 0.75,
        size: 1 + Math.random() * 2.2,
        color: Math.random() < 0.35 ? '#fde68a' : color,
      })
    }
  }

  // ---------------------------------------------------------------- render

  /** 2:1 isometric projection. World y grows upward. */
  private project(x: number, z: number, y: number): [number, number] {
    const sx = this.cx + (x - z)
    const sy = this.cy + (x + z) * 0.5 - (y - this.camY)
    return [sx, sy]
  }

  private faceColors(hue: number, beacon: boolean): { top: string; right: string; left: string } {
    const sat = beacon ? 90 : 80
    const l = beacon ? 8 : 0
    return {
      top: `hsl(${hue}, ${sat}%, ${54 + l}%)`,
      right: `hsl(${hue}, ${sat}%, ${40 + l}%)`,
      left: `hsl(${hue}, ${sat}%, ${30 + l}%)`,
    }
  }

  /** Draws an iso box: top face + two visible side faces. h = face height. */
  private drawBox(
    x: number,
    z: number,
    w: number,
    d: number,
    yTop: number,
    h: number,
    hue: number,
    opts: { flash?: number; alpha?: number; beacon?: boolean } = {},
  ): void {
    const ctx = this.ctx
    const hw = w / 2
    const hd = d / 2
    // top-face corners: A north (top), B east (right), C south (bottom), D west (left)
    const [ax, ay] = this.project(x - hw, z - hd, yTop)
    const [bx, by] = this.project(x + hw, z - hd, yTop)
    const [cxx, cy2] = this.project(x + hw, z + hd, yTop)
    const [dx, dy] = this.project(x - hw, z + hd, yTop)
    // bottom corners sit exactly h px below their top counterparts
    const bbY = by + h
    const cbY = cy2 + h
    const dbY = dy + h

    const c = this.faceColors(hue, opts.beacon ?? false)
    const alpha = opts.alpha ?? 1
    ctx.globalAlpha = alpha

    const pathRight = () => {
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(cxx, cy2)
      ctx.lineTo(cxx, cbY)
      ctx.lineTo(bx, bbY)
      ctx.closePath()
    }
    const pathLeft = () => {
      ctx.beginPath()
      ctx.moveTo(dx, dy)
      ctx.lineTo(cxx, cy2)
      ctx.lineTo(cxx, cbY)
      ctx.lineTo(dx, dbY)
      ctx.closePath()
    }
    const pathTop = () => {
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.lineTo(cxx, cy2)
      ctx.lineTo(dx, dy)
      ctx.closePath()
    }

    // right face (east-south)
    ctx.fillStyle = c.right
    pathRight()
    ctx.fill()
    // left face (west-south)
    ctx.fillStyle = c.left
    pathLeft()
    ctx.fill()
    // top face + crisp edge
    ctx.fillStyle = c.top
    pathTop()
    ctx.fill()
    ctx.strokeStyle = `hsla(${hue}, 90%, 72%, ${0.35 * alpha})`
    ctx.lineWidth = 1
    ctx.stroke()

    // perfect flash — white overlay on all faces
    const flash = opts.flash ?? 0
    if (flash > 0.01) {
      ctx.fillStyle = '#ffffff'
      ctx.globalAlpha = alpha * flash * 0.85
      pathTop()
      ctx.fill()
      ctx.globalAlpha = alpha * flash * 0.4
      pathRight()
      ctx.fill()
      pathLeft()
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private drawBackground(dt: number): void {
    const ctx = this.ctx
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, this.W, this.H)

    // vignette
    const grad = ctx.createRadialGradient(
      this.cx,
      this.H * 0.35,
      this.S * 0.4,
      this.cx,
      this.H * 0.5,
      Math.max(this.W, this.H) * 0.85,
    )
    grad.addColorStop(0, 'rgba(30, 12, 12, 0.35)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, this.W, this.H)

    // milestone pulse
    if (this.bgPulse > 0.01) {
      ctx.fillStyle = `rgba(239, 68, 68, ${this.bgPulse * 0.1})`
      ctx.fillRect(0, 0, this.W, this.H)
    }

    // altitude ruler — line every 10 blocks
    const step = this.BH * 10
    const yTopView = this.camY + this.H * 0.5
    const yBotView = this.camY - this.H * 0.85
    const kStart = Math.max(1, Math.ceil((yBotView - this.BH) / step))
    const kEnd = Math.ceil((yTopView - this.BH) / step)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.font = '700 9px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'left'
    for (let k = kStart; k <= kEnd; k++) {
      const y = (k * 10 + 1) * this.BH
      const [, sy] = this.project(0, 0, y)
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(this.W, sy)
      ctx.stroke()
      ctx.fillText(`ALT ${k * 10}`, 10, sy - 4)
    }

    // dust motes
    for (const p of this.dust) {
      p.y -= p.v * dt
      if (p.y < -4) {
        p.y = this.H + 4
        p.x = Math.random() * this.W
      }
      ctx.fillStyle = `rgba(253, 230, 138, ${p.a})`
      ctx.fillRect(p.x, p.y, p.s, p.s)
    }
  }

  private drawFoundation(): void {
    const base = this.blocks[0]
    if (!base) return
    // column running down from the base block
    this.drawBox(base.x, base.z, base.w, base.d, 0, this.H * 1.5, 10, { alpha: 0.55 })
  }

  private drawRings(): void {
    const ctx = this.ctx
    for (const r of this.rings) {
      const t = 1 - r.life / 0.5 // 0 -> 1
      const grow = 1 + t * 0.9
      const hw = (r.w * grow) / 2
      const hd = (r.d * grow) / 2
      const [ax, ay] = this.project(r.x - hw, r.z - hd, r.y)
      const [bx, by] = this.project(r.x + hw, r.z - hd, r.y)
      const [cxx, cy2] = this.project(r.x + hw, r.z + hd, r.y)
      const [dx, dy] = this.project(r.x - hw, r.z + hd, r.y)
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.8 * (1 - t)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.lineTo(cxx, cy2)
      ctx.lineTo(dx, dy)
      ctx.closePath()
      ctx.stroke()
    }
  }

  private drawPopups(): void {
    const ctx = this.ctx
    ctx.textAlign = 'center'
    for (const p of this.popups) {
      const t = 1 - p.life / p.maxLife
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.5))
      ctx.fillStyle = p.color
      ctx.font = `700 ${p.size}px ui-monospace, Menlo, monospace`
      ctx.fillText(p.text, p.sx + 1, p.sy - t * 42 + 1)
      ctx.fillText(p.text, p.sx, p.sy - t * 42)
      ctx.globalAlpha = 1
    }
    ctx.textAlign = 'left'
  }

  private drawParticles(): void {
    const ctx = this.ctx
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
      ctx.fillStyle = p.color
      ctx.fillRect(p.sx, p.sy, p.size, p.size)
    }
    ctx.globalAlpha = 1
  }

  // ---------------------------------------------------------------- loop

  private loop = (t: number): void => {
    if (this.dead) return
    const dt = Math.min(0.05, (t - this.lastT) / 1000)
    this.lastT = t
    this.update(dt)
    this.render(dt)
    this.raf = requestAnimationFrame(this.loop)
  }

  private update(dt: number): void {
    // camera
    this.camY += (this.camTarget - this.camY) * Math.min(1, dt * 5)

    // slider ping-pong
    if (this.phase === 'playing') {
      this.slidePos += this.slideDir * this.slideSpeed * dt
      if (this.slidePos > this.range) {
        this.slidePos = this.range
        this.slideDir = -1
      } else if (this.slidePos < -this.range) {
        this.slidePos = -this.range
        this.slideDir = 1
      }
    }

    // blocks flash decay
    for (const b of this.blocks) b.flash = Math.max(0, b.flash - dt * 3.2)

    // debris — world y falls
    const g = 2400
    for (const p of this.pieces) {
      p.vy += g * dt
      p.y -= p.vy * dt
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.life -= dt
      if (p.life < 0.6) p.alpha = Math.max(0, p.life / 0.6)
    }
    this.pieces = this.pieces.filter((p) => p.alpha > 0)

    // particles (screen space)
    for (const p of this.particles) {
      p.vy += 1500 * dt
      p.sx += p.vx * dt
      p.sy += p.vy * dt
      p.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)

    // popups & rings
    for (const p of this.popups) p.life -= dt
    this.popups = this.popups.filter((p) => p.life > 0)
    for (const r of this.rings) r.life -= dt
    this.rings = this.rings.filter((r) => r.life > 0)

    // fx decay
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt)
    else this.shakeMag = 0
    this.bgPulse = Math.max(0, this.bgPulse - dt * 1.4)
  }

  private render(dt: number): void {
    const ctx = this.ctx
    ctx.save()

    if (this.shakeT > 0 && this.shakeMag > 0) {
      const k = this.shakeT * this.shakeMag
      ctx.translate((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k)
    }

    this.drawBackground(dt)
    this.drawFoundation()

    // tower — draw only the visible top slice
    const start = Math.max(0, this.blocks.length - 26)
    for (let i = start; i < this.blocks.length; i++) {
      const b = this.blocks[i]
      const yTop = (i + 1) * this.BH
      this.drawBox(b.x, b.z, b.w, b.d, yTop, this.BH, b.hue, {
        flash: b.flash,
        beacon: i % 10 === 0 && i > 0,
      })
    }

    // sliding block
    if (this.phase === 'playing') {
      const top = this.blocks[this.blocks.length - 1]
      const sx = this.axis === 'x' ? this.slidePos : top.x
      const sz = this.axis === 'z' ? this.slidePos : top.z
      this.drawBox(sx, sz, top.w, top.d, this.topY + this.BH, this.BH, this.blockHue(this.blocks.length))
    }

    // debris above the tower (drawn after so it passes "in front")
    for (const p of this.pieces) {
      this.drawBox(p.x, p.z, p.w, p.d, p.y, this.BH, p.hue, { alpha: p.alpha })
    }

    this.drawRings()
    this.drawParticles()
    this.drawPopups()

    ctx.restore()
  }
}
