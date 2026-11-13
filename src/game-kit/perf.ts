// game-kit — dev-only performance overlay: FPS (EMA), frame time, JS heap.
//
// Ships ZERO bytes of UI to players: it mounts only when enabled via
// `?perf=1` (or import.meta.env.DEV). Heap numbers need performance.memory
// (Chromium-only) — absent elsewhere, shown as "—".

export class PerfOverlay {
  private el: HTMLDivElement | null = null
  private rafId = 0
  private lastTs = 0
  private fpsEma = 60
  private frameMsEma = 16.7
  private lastPaint = 0
  private destroyed = false

  /** true when the overlay should exist at all */
  static wanted(): boolean {
    if (typeof window === 'undefined') return false
    const dev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development'
    return dev || new URLSearchParams(window.location.search).has('perf')
  }

  mount(parent: HTMLElement = document.body): void {
    if (this.el || this.destroyed || typeof document === 'undefined') return
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = [
      'position:fixed',
      'left:8px',
      'bottom:8px',
      'z-index:2147483647',
      'padding:6px 10px',
      'font:11px/1.5 ui-monospace,monospace',
      'color:#0f0',
      'background:rgba(0,0,0,0.7)',
      'border-radius:4px',
      'pointer-events:none',
      'white-space:pre',
    ].join(';')
    parent.appendChild(el)
    this.el = el
    this.lastTs = performance.now()
    this.rafId = requestAnimationFrame(this.tick)
  }

  private tick = (ts: number): void => {
    if (this.destroyed || !this.el) return
    const dt = ts - this.lastTs
    this.lastTs = ts
    if (dt > 0 && dt < 1000) {
      const fps = 1000 / dt
      this.fpsEma += (fps - this.fpsEma) * 0.05
      this.frameMsEma += (dt - this.frameMsEma) * 0.05
    }
    if (ts - this.lastPaint > 250) {
      this.lastPaint = ts
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      const heapMb = mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) : '—'
      this.el.textContent =
        `${this.fpsEma.toFixed(0)} fps · ${this.frameMsEma.toFixed(1)} ms · heap ${heapMb} MB`
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  destroy(): void {
    this.destroyed = true
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.el?.remove()
    this.el = null
  }
}
