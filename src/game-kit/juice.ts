// game-kit — juice utilities: trauma shake, particles, tweens, hit-stop.
//
// All motion respects prefers-reduced-motion: shake/hit-stop/particle counts
// collapse to (near) zero when the user asked the OS for less motion.

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---------------------------------------------------------------- shake

/**
 * Trauma-based screen shake (Squirrel Eiserloh's method): add trauma on impact,
 * it decays over time, shake = trauma². Squaring makes small hits subtle and
 * big hits visceral, and the decay makes it always settle.
 */
export class TraumaShake {
  private trauma = 0

  constructor(
    private readonly maxOffset = 18,
    private readonly decayPerSec = 1.6,
  ) {}

  /** add(amount 0..1). Big events can cut through by adding more than 1. */
  add(amount: number): void {
    if (prefersReducedMotion()) return
    this.trauma = Math.min(1.2, this.trauma + amount)
  }

  /** current intensity 0..1 (trauma squared, clamped) */
  get intensity(): number {
    return Math.min(1, this.trauma * this.trauma)
  }

  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - this.decayPerSec * dt)
  }

  /** random offset at the current intensity (jitter source is cosmetic-only) */
  offset(cosmeticRand: () => number): { x: number; y: number } {
    const s = this.intensity * this.maxOffset
    return { x: (cosmeticRand() * 2 - 1) * s, y: (cosmeticRand() * 2 - 1) * s }
  }

  reset(): void {
    this.trauma = 0
  }
}

// ---------------------------------------------------------------- particles

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number // seconds remaining
  maxLife: number
  size: number
  color: string
  gravity: number
  alive: boolean
}

export interface ParticleOpts {
  x: number
  y: number
  count?: number
  speedMin?: number
  speedMax?: number
  angleMin?: number // radians; default 0 (right)
  angleMax?: number // default 2π (full circle)
  lifeMin?: number
  lifeMax?: number
  sizeMin?: number
  sizeMax?: number
  color: string | string[]
  gravity?: number
}

/**
 * Simple pool-backed particle system. `rand` must be the COSMETIC rng stream —
 * particles are pure eye-candy and must never affect logic determinism.
 */
export class ParticleSystem {
  private items: Particle[] = []

  constructor(private readonly max = 600) {}

  burst(rand: () => number, o: ParticleOpts): void {
    if (prefersReducedMotion()) return
    const count = o.count ?? 12
    const colors = Array.isArray(o.color) ? o.color : [o.color]
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.max) this.items.shift()
      const angle =
        (o.angleMin ?? 0) + rand() * ((o.angleMax ?? Math.PI * 2) - (o.angleMin ?? 0))
      const speed = (o.speedMin ?? 40) + rand() * ((o.speedMax ?? 160) - (o.speedMin ?? 40))
      const life = (o.lifeMin ?? 0.3) + rand() * ((o.lifeMax ?? 0.8) - (o.lifeMin ?? 0.3))
      this.items.push({
        x: o.x,
        y: o.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: (o.sizeMin ?? 2) + rand() * ((o.sizeMax ?? 5) - (o.sizeMin ?? 2)),
        color: colors[Math.floor(rand() * colors.length)],
        gravity: o.gravity ?? 220,
        alive: true,
      })
    }
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.life -= dt
      if (p.life <= 0) {
        p.alive = false
        continue
      }
      p.vy += p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    if (this.items.some((p) => !p.alive)) {
      this.items = this.items.filter((p) => p.alive)
    }
  }

  /** draw with a 2D context; alpha fades with remaining life */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    }
    ctx.globalAlpha = 1
  }

  get count(): number {
    return this.items.length
  }

  clear(): void {
    this.items.length = 0
  }
}

// ---------------------------------------------------------------- tweens

export type EaseFn = (t: number) => number

export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3)
export const easeInCubic: EaseFn = (t) => t * t * t
export const easeOutBack: EaseFn = (t) => {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
export const easeInOutQuad: EaseFn = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
export const easeOutElastic: EaseFn = (t) => {
  if (t === 0 || t === 1) return t
  const c4 = (2 * Math.PI) / 3
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}

export interface Tween {
  /** 0..1 progress after easing */
  t: number
  done: boolean
}

/**
 * Minimal tween runner: `tweens.add(0.25, easeOutCubic, (easedT) => {...})`.
 * Call update(dt) once per frame. No allocations beyond the closure.
 */
export class Tweens {
  private items: {
    elapsed: number
    duration: number
    ease: EaseFn
    onUpdate: (easedT: number, rawT: number) => void
    onComplete?: () => void
    done: boolean
  }[] = []

  add(
    durationSec: number,
    ease: EaseFn,
    onUpdate: (easedT: number, rawT: number) => void,
    onComplete?: () => void,
  ): void {
    this.items.push({
      elapsed: 0,
      duration: Math.max(0.0001, durationSec),
      ease,
      onUpdate,
      onComplete,
      done: false,
    })
  }

  update(dt: number): void {
    for (const tw of this.items) {
      if (tw.done) continue
      tw.elapsed += dt
      const raw = Math.min(1, tw.elapsed / tw.duration)
      tw.onUpdate(tw.ease(raw), raw)
      if (raw >= 1) {
        tw.done = true
        tw.onComplete?.()
      }
    }
    this.items = this.items.filter((t) => !t.done)
  }

  get active(): number {
    return this.items.length
  }

  clear(): void {
    this.items.length = 0
  }
}

// ---------------------------------------------------------------- hit-stop

/**
 * Hit-stop (frame freeze) on impacts: freeze the world for a few ms so a hit
 * READS as heavy. update() returns true while frozen — skip world updates then.
 * Reduced motion: disabled entirely (a freeze is motion too, in a sense — and
 * users asking for less motion get none of it).
 */
export class HitStop {
  private remaining = 0

  trigger(durationSec: number): void {
    if (prefersReducedMotion()) return
    this.remaining = Math.max(this.remaining, durationSec)
  }

  update(dt: number): boolean {
    if (this.remaining <= 0) return false
    this.remaining -= dt
    return true
  }

  get active(): boolean {
    return this.remaining > 0
  }

  clear(): void {
    this.remaining = 0
  }
}
