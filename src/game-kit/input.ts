// game-kit — unified input: keyboard + mouse + touch, one API.
//
// Touch rules (hyper-casual QA items):
//  - `touch-action: none` on the game surface (set by the host CSS, enforced
//    here by preventDefault on touchstart/move) ⇒ no page scroll/pan.
//  - no double-tap zoom / long-press callout: CSS + preventDefault on
//    touchend when it wasn't a scroll (there is no scroll — see above).
//  - no context menu on long-press / right-click hold.
//
// Edge detection: `justDown` flags are valid for one frame — the host calls
// endFrame() at the end of each render tick (works with the engines' rAF too:
// they can flush on their own cadence).

export interface PointerState {
  /** canvas-space coordinates */
  x: number
  y: number
  down: boolean
  justDown: boolean
  justUp: boolean
}

export interface FirstInputEvent {
  kind: 'key' | 'pointer' | 'touch' | 'gamepad'
}

export class UnifiedInput {
  private keysDown = new Set<string>()
  private keysPressed = new Set<string>()
  private keysReleased = new Set<string>()
  private firstInputFired = false
  private firstInputCbs = new Set<(e: FirstInputEvent) => void>()
  private attached = false

  readonly pointer: PointerState = { x: 0, y: 0, down: false, justDown: false, justUp: false }

  constructor(private readonly surface: HTMLCanvasElement) {}

  attach(): void {
    if (this.attached) return
    this.attached = true
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.surface.addEventListener('pointerdown', this.onPointerDown)
    this.surface.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    this.surface.addEventListener('contextmenu', this.onContextMenu)
    this.surface.addEventListener('touchstart', this.onTouchStart, { passive: false })
    this.surface.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.surface.addEventListener('touchend', this.onTouchEnd, { passive: false })
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.surface.removeEventListener('pointerdown', this.onPointerDown)
    this.surface.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    this.surface.removeEventListener('contextmenu', this.onContextMenu)
    this.surface.removeEventListener('touchstart', this.onTouchStart)
    this.surface.removeEventListener('touchmove', this.onTouchMove)
    this.surface.removeEventListener('touchend', this.onTouchEnd)
    this.keysDown.clear()
    this.keysPressed.clear()
    this.keysReleased.clear()
    this.firstInputCbs.clear()
  }

  // ---- queries -------------------------------------------------------------

  /** key currently held (KeyboardEvent.code, e.g. 'ArrowLeft') */
  held(code: string): boolean {
    return this.keysDown.has(code)
  }

  /** key went down since the last endFrame() */
  pressed(code: string): boolean {
    return this.keysPressed.has(code)
  }

  /** key went up since the last endFrame() */
  released(code: string): boolean {
    return this.keysReleased.has(code)
  }

  /** clear per-frame edge flags — call once per rendered frame */
  endFrame(): void {
    this.keysPressed.clear()
    this.keysReleased.clear()
    this.pointer.justDown = false
    this.pointer.justUp = false
  }

  /** any of the given codes held (D-pad style helper) */
  anyHeld(...codes: string[]): boolean {
    return codes.some((c) => this.keysDown.has(c))
  }

  // ---- first input (portal requirement: gameplayStart only on real input) ---

  onFirstInput(cb: (e: FirstInputEvent) => void): () => void {
    this.firstInputCbs.add(cb)
    return () => this.firstInputCbs.delete(cb)
  }

  private fireFirstInput(kind: FirstInputEvent['kind']): void {
    if (this.firstInputFired) return
    this.firstInputFired = true
    for (const cb of this.firstInputCbs) cb({ kind })
  }

  // ---- handlers ------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    this.fireFirstInput('key')
    if (!this.keysDown.has(e.code)) {
      this.keysDown.add(e.code)
      this.keysPressed.add(e.code)
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.keysDown.delete(e.code)) this.keysReleased.add(e.code)
  }

  private onBlur = (): void => {
    // no stuck keys after alt-tab
    for (const code of this.keysDown) this.keysReleased.add(code)
    this.keysDown.clear()
    this.pointer.down = false
  }

  private canvasPoint(e: PointerEvent): { x: number; y: number } {
    const r = this.surface.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.fireFirstInput('pointer')
    const p = this.canvasPoint(e)
    this.pointer.x = p.x
    this.pointer.y = p.y
    this.pointer.down = true
    this.pointer.justDown = true
    if (e.pointerType === 'touch') e.preventDefault()
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.canvasPoint(e)
    this.pointer.x = p.x
    this.pointer.y = p.y
  }

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.canvasPoint(e)
    this.pointer.x = p.x
    this.pointer.y = p.y
    if (this.pointer.down) this.pointer.justUp = true
    this.pointer.down = false
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault()
  }

  private onTouchStart = (e: TouchEvent): void => {
    this.fireFirstInput('touch')
    e.preventDefault() // no scroll / no double-tap zoom from the game surface
  }

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
  }

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault() // no long-press callout, no synthetic click zoom
  }
}
