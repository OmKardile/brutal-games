// game-kit — canvas scaler: 16:9 letterbox (or free aspect), DPR capped at 2,
// safe-area insets exposed.
//
// Backing-store resolution = CSS size × devicePixelRatio (capped — a 3× phone
// screen gains nothing visible from 3× pixels but burns battery). The scaler
// observes its container, so resize/orientation changes re-fit automatically.

export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/** Read env() safe-area insets (notches, home bars). Fails soft to 0. */
export function safeAreaInsets(): SafeAreaInsets {
  if (typeof window === 'undefined' || typeof CSS === 'undefined' || !CSS.supports) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  const read = (prop: string): number => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim()
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return {
    top: read('env(safe-area-inset-top)'),
    right: read('env(safe-area-inset-right)'),
    bottom: read('env(safe-area-inset-bottom)'),
    left: read('env(safe-area-inset-left)'),
  }
}

export interface ScalerOptions {
  /** target aspect ratio width/height; omit for "fill container" */
  aspect?: number
  /** device pixel ratio cap (default 2) */
  maxDpr?: number
}

export interface CanvasMetrics {
  cssWidth: number
  cssHeight: number
  /** backing store pixels */
  width: number
  height: number
  dpr: number
}

export class CanvasScaler {
  private ro: ResizeObserver | null = null
  private destroyed = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: ScalerOptions = {},
  ) {}

  /** Attach + do the first fit. Returns current metrics. */
  attach(): CanvasMetrics {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', this.fit)
      window.addEventListener('orientationchange', this.fit)
    } else {
      this.ro = new ResizeObserver(() => this.fit())
      this.ro.observe(this.canvas.parentElement ?? this.canvas)
    }
    return this.fit()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.ro?.disconnect()
    window.removeEventListener('resize', this.fit)
    window.removeEventListener('orientationchange', this.fit)
  }

  /** Compute + apply one fit. Safe to call manually. */
  fit = (): CanvasMetrics => {
    const parent = this.canvas.parentElement
    const cw = parent?.clientWidth ?? window.innerWidth
    const ch = parent?.clientHeight ?? window.innerHeight
    const dpr = Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      this.opts.maxDpr ?? 2,
    )

    let cssW = cw
    let cssH = ch
    if (this.opts.aspect && this.opts.aspect > 0) {
      // letterbox: largest aspect-correct rect fitting the container
      if (cw / ch > this.opts.aspect) {
        cssW = Math.round(ch * this.opts.aspect)
        cssH = ch
      } else {
        cssW = cw
        cssH = Math.round(cw / this.opts.aspect)
      }
    }

    // round to whole device pixels to avoid seam artifacts
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    return { cssWidth: cssW, cssHeight: cssH, width: w, height: h, dpr }
  }
}
