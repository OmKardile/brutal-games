// game-kit — fixed-timestep game loop with clamped delta.
//
// Determinism and physics stability need a FIXED step: logic always advances in
// exactly `stepMs` increments, no matter the display refresh rate (a 144 Hz
// screen must not make the game 2.4× faster than a 60 Hz one). Rendering runs
// once per animation frame with an interpolation alpha.
//
// Clamping: wall-clock deltas are capped (tab was hidden, breakpoint, GC hitch)
// and the number of catch-up steps per frame is bounded, so a stall can never
// cause a spiral of death — time is deliberately dropped, not replayed.

export interface LoopOptions {
  /** fixed logic step in ms (default 1000/60) */
  stepMs?: number
  /** max wall-clock delta accepted per frame in ms (default 250) */
  maxFrameMs?: number
  /** max logic steps executed per frame (default 5; extra time is dropped) */
  maxStepsPerFrame?: number
  /** fixed-step logic update. stepSec is constant. */
  update: (stepSec: number) => void
  /** per-frame render. alpha ∈ [0,1) = fraction into the next logic step. */
  render: (alpha: number, frameDtSec: number) => void
}

export class GameLoop {
  private rafId = 0
  private lastTs = 0
  private initialized = false
  private acc = 0
  private _running = false

  readonly stepMs: number
  private readonly maxFrameMs: number
  private readonly maxSteps: number
  private readonly updateFn: (stepSec: number) => void
  private readonly renderFn: (alpha: number, frameDtSec: number) => void

  constructor(opts: LoopOptions) {
    this.stepMs = opts.stepMs ?? 1000 / 60
    this.maxFrameMs = opts.maxFrameMs ?? 250
    this.maxSteps = opts.maxStepsPerFrame ?? 5
    this.updateFn = opts.update
    this.renderFn = opts.render
  }

  get running(): boolean {
    return this._running
  }

  start(): void {
    if (this._running || typeof window === 'undefined') return
    this._running = true
    this.initialized = false
    this.lastTs = 0
    this.acc = 0
    this.rafId = window.requestAnimationFrame(this.tick)
  }

  stop(): void {
    this._running = false
    if (this.rafId) window.cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  private tick = (ts: number): void => {
    if (!this._running) return
    if (!this.initialized) {
      // first frame: establish a baseline, no time passes
      this.initialized = true
      this.lastTs = ts
    }
    // clamp: a hidden tab / GC pause must not dump seconds of catch-up on us
    const wallDt = Math.min(ts - this.lastTs, this.maxFrameMs)
    this.lastTs = ts
    this.acc += wallDt

    let steps = 0
    while (this.acc >= this.stepMs && steps < this.maxSteps) {
      this.updateFn(this.stepMs / 1000)
      this.acc -= this.stepMs
      steps++
    }
    // drop time we can't catch up (spiral-of-death guard)
    if (steps === this.maxSteps && this.acc > this.stepMs) this.acc = 0

    this.renderFn(this.stepMs > 0 ? this.acc / this.stepMs : 0, wallDt / 1000)
    this.rafId = window.requestAnimationFrame(this.tick)
  }
}

// ---------------------------------------------------------------------------
// Pause manager — one reason ledger for every reason the game must stop:
// tab hidden, ad playing, orientation change, host pause. The game pauses when
// ANY reason is present and resumes only when the last one clears.
// ---------------------------------------------------------------------------

export type PauseReason = 'hidden' | 'ad' | 'orientation' | 'host'

export class PauseManager {
  private reasons = new Set<PauseReason>()
  private started = false
  onChange: (paused: boolean, reason: PauseReason | null) => void = () => {}

  /** Start listening to document visibility + orientation changes. */
  attach(): void {
    if (this.started || typeof document === 'undefined') return
    this.started = true
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('orientationchange', this.onOrientation)
  }

  detach(): void {
    if (!this.started) return
    this.started = false
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('orientationchange', this.onOrientation)
    this.reasons.clear()
  }

  add(reason: PauseReason): void {
    const was = this.paused
    this.reasons.add(reason)
    if (this.paused !== was) this.onChange(true, reason)
  }

  remove(reason: PauseReason): void {
    const was = this.paused
    this.reasons.delete(reason)
    if (this.paused !== was) this.onChange(this.paused, null)
  }

  get paused(): boolean {
    return this.reasons.size > 0
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.add('hidden')
    else this.remove('hidden')
  }

  private onOrientation = (): void => {
    // brief pause while the OS rotates; cleared on the next resize/settle.
    this.add('orientation')
    window.setTimeout(() => this.remove('orientation'), 350)
  }
}
