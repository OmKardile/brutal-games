// game-kit — production quality monitor (roadmap slice 2, lite mode).
//
// A tiny FPS watcher that runs INSIDE the game stage (not the dev overlay):
// samples frame timestamps, keeps an EMA, and when the device clearly cannot
// hold ~50fps over a sustained window it degrades PAGE-OWNED effects —
// never engine internals (engines are off-limits, house rule):
//   tier 0 FULL    — everything as shipped
//   tier 1 LITE    — page animations off (CSS class), DPR cap 1.5
//   tier 2 ULTRA   — animations off + DPR cap 1 (2-3 GB RAM phones)
// Degrade is one-way per session: once a device has proven weak, we don't
// yo-yo the quality mid-run. A manual override (auto|lite|off) is exposed
// so players on strong devices can force LITE to save battery/data, and
// players who dislike auto-degrade can pin FULL at their own risk.
//
// Engine-side particles/shake are untouched in v1 (they live in the
// engines); page-level motion (hero art parallax, scan lines, grain,
// flicker/glow animations) is what we kill — that's the majority of the
// compositing cost OUTSIDE the canvas on low-end Androids.

export type QualityTier = 0 | 1 | 2

export interface QualityState {
  tier: QualityTier
  /** manual override: 'auto' (watch fps), 'lite' (pin tier 1), 'off' (pin 0) */
  mode: 'auto' | 'lite' | 'off'
  fpsEma: number
  /** true when an auto-degrade actually fired (shown in the label) */
  auto: boolean
}

const STORAGE_KEY = 'brutal.quality'
const TIER_DPR_CAP: Record<QualityTier, number> = { 0: 2, 1: 1.5, 2: 1 }

/** DPR cap for a tier — CanvasScaler consumes this via GameCtx. */
export function dprCapFor(tier: QualityTier): number {
  return TIER_DPR_CAP[tier]
}

export function readQualityMode(): 'auto' | 'lite' | 'off' {
  if (typeof window === 'undefined') return 'auto'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'lite' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeQualityMode(mode: 'auto' | 'lite' | 'off'): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // storage unavailable — session-only
  }
}

export class QualityMonitor {
  private rafId = 0
  private lastTs = 0
  private ema = 60
  private lastDegradeAt = 0
  private destroyed = false
  private samples = 0

  constructor(
    private readonly onTier: (tier: QualityTier, state: QualityState) => void,
    private mode: 'auto' | 'lite' | 'off' = readQualityMode(),
  ) {}

  get state(): QualityState {
    return {
      tier: this.tier,
      mode: this.mode,
      fpsEma: Math.round(this.ema),
      auto: this.mode === 'auto' && this.tier > 0,
    }
  }

  private tier: QualityTier = this.mode === 'lite' ? 1 : 0

  /** Begin watching. Applies the initial (mode-derived) tier immediately. */
  start(): void {
    if (this.destroyed || typeof requestAnimationFrame !== 'function') return
    this.onTier(this.tier, this.state)
    if (this.mode !== 'auto') return // pinned modes never watch
    this.lastTs = performance.now()
    this.rafId = requestAnimationFrame(this.tick)
  }

  destroy(): void {
    this.destroyed = true
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId)
  }

  /** Cycle auto → lite → off → auto (the in-game toggle). */
  cycleMode(): 'auto' | 'lite' | 'off' {
    this.mode = this.mode === 'auto' ? 'lite' : this.mode === 'lite' ? 'off' : 'auto'
    writeQualityMode(this.mode)
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId)
    this.samples = 0
    this.ema = 60
    this.tier = this.mode === 'lite' ? 1 : 0
    this.onTier(this.tier, this.state)
    if (this.mode === 'auto') {
      this.lastTs = performance.now()
      if (typeof requestAnimationFrame === 'function') {
        this.rafId = requestAnimationFrame(this.tick)
      }
    }
    return this.mode
  }

  private tick = (ts: number): void => {
    if (this.destroyed) return
    const dt = ts - this.lastTs
    this.lastTs = ts
    if (dt > 0 && dt < 500) {
      // skip absurd gaps (tab switch) — they're not the device's fault
      const fps = 1000 / dt
      this.ema = this.ema * 0.9 + fps * 0.1
      this.samples++
    }
    // verdict after enough signal (≥ ~3s of frames), then hold
    // (cooldown applies BETWEEN degrades — the first verdict fires freely)
    if (this.samples >= 150 && this.tier < 2) {
      if (this.ema < 50 && (this.lastDegradeAt === 0 || ts - this.lastDegradeAt > 8000)) {
        this.tier = (this.tier + 1) as QualityTier
        this.lastDegradeAt = ts
        this.onTier(this.tier, this.state)
        if (this.tier >= 2) return // ULTRA is terminal for this session
      }
    }
    this.rafId = requestAnimationFrame(this.tick)
  }
}
