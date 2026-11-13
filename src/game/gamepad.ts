// BRUTAL — shared Gamepad API reader (standard mapping), zero dependencies.
//
// Both games poll `GamepadReader` once per frame from their render loop. The
// reader exposes normalized stick vectors (radial deadzone), held state for
// fire, and edge-triggered (just-pressed) face/shoulder/start buttons so each
// engine can map them to its own actions. It also wraps the vibration
// actuator ("dual-rumble") with a throttle so rapid kill feedback does not
// starve stronger hits.
//
// Browser notes:
//  - Chrome only surfaces a pad after the first button press; the
//    gamepadconnected event fires then. `subscribeGamepads` reports both.
//  - Non-standard-mapping pads fall back to the same indices (best effort).
//  - Everything is guarded for SSR — a disconnected snapshot is returned.

export interface PadSnapshot {
  connected: boolean
  id: string
  /** left stick + d-pad merged, each component in [-1, 1], magnitude <= 1 */
  move: { x: number; y: number }
  /** right stick, each component in [-1, 1], magnitude <= 1 */
  aim: { x: number; y: number }
  /** right stick pushed past the aim deadzone */
  aimActive: boolean
  /** RT / RB / LT / A held — the "shoot" cluster */
  fire: boolean
  // edge-triggered (true only on the frame the button goes down)
  a: boolean // A / Cross
  b: boolean // B / Circle
  x: boolean // X / Square
  y: boolean // Y / Triangle
  lb: boolean
  rb: boolean
  lt: boolean
  rt: boolean
  start: boolean // Start / Options
  back: boolean // Back / Select / Share
  l3: boolean
  r3: boolean
  /** any edge-triggered button this frame */
  anyEdge: boolean
  /** performance.now() of the last stick/button activity (0 = never) */
  lastInputAt: number
}

// standard-mapping button indices
const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DUP: 12,
  DDOWN: 13,
  DLEFT: 14,
  DRIGHT: 15,
} as const

const MOVE_DZ = 0.18
const AIM_DZ = 0.22
const TRIGGER_ON = 0.4
const RUMBLE_MIN_GAP_MS = 50

const EMPTY_SNAPSHOT: PadSnapshot = {
  connected: false,
  id: '',
  move: { x: 0, y: 0 },
  aim: { x: 0, y: 0 },
  aimActive: false,
  fire: false,
  a: false,
  b: false,
  x: false,
  y: false,
  lb: false,
  rb: false,
  lt: false,
  rt: false,
  start: false,
  back: false,
  l3: false,
  r3: false,
  anyEdge: false,
  lastInputAt: 0,
}

function emptySnapshot(): PadSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    move: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
  }
}

/** radial deadzone with magnitude rescale — preserves direction and partial tilt */
function deadzone(x: number, y: number, dz: number): { x: number; y: number; active: boolean } {
  const m = Math.hypot(x, y)
  if (m <= dz || !Number.isFinite(m)) return { x: 0, y: 0, active: false }
  const k = Math.min(1, (m - dz) / (1 - dz)) / m
  return { x: x * k, y: y * k, active: true }
}

function firstPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
  const pads = navigator.getGamepads()
  let fallback: Gamepad | null = null
  for (const p of pads) {
    if (!p || !p.connected) continue
    if (p.mapping === 'standard') return p
    if (!fallback) fallback = p
  }
  return fallback
}

function cleanId(id: string): string {
  // "Xbox 360 Controller (XInput STANDARD GAMEPAD Vendor: 045e Product: 028e)"
  const base = id.replace(/\(.*?\)/g, '').replace(/vendor.*$/i, '').trim()
  const short = base || id
  return short.length > 28 ? `${short.slice(0, 28)}…` : short
}

export class GamepadReader {
  private prev: boolean[] = []
  private lastRumbleAt = 0
  private hasWindow = typeof window !== 'undefined'

  constructor() {
    if (!this.hasWindow) return
    // connection flips are also picked up by poll(); listeners just nudge state
    window.addEventListener('gamepadconnected', GamepadReader.markSeen)
    window.addEventListener('gamepaddisconnected', GamepadReader.markSeen)
  }

  destroy(): void {
    if (!this.hasWindow) return
    window.removeEventListener('gamepadconnected', GamepadReader.markSeen)
    window.removeEventListener('gamepaddisconnected', GamepadReader.markSeen)
  }

  private static markSeen = (): void => {
    /* no-op — poll() reads live state every frame */
  }

  /** Call once per frame. Cheap: reads one Gamepad object, no allocations beyond the snapshot. */
  poll(): PadSnapshot {
    const snap = emptySnapshot()
    const pad = firstPad()
    if (!pad) {
      this.prev = []
      return snap
    }
    snap.connected = true
    snap.id = cleanId(pad.id)

    // ---- sticks -----------------------------------------------------------
    const lx = pad.axes[0] ?? 0
    const ly = pad.axes[1] ?? 0
    const mv = deadzone(lx, ly, MOVE_DZ)
    snap.move.x = mv.x
    snap.move.y = mv.y
    if (mv.active) snap.lastInputAt = performance.now()

    const rx = pad.axes[2] ?? 0
    const ry = pad.axes[3] ?? 0
    const am = deadzone(rx, ry, AIM_DZ)
    snap.aim.x = am.x
    snap.aim.y = am.y
    snap.aimActive = am.active
    if (am.active) snap.lastInputAt = performance.now()

    // ---- buttons ----------------------------------------------------------
    const held: boolean[] = []
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i]
      held[i] = !!(b && (b.pressed || b.value > TRIGGER_ON))
    }
    const edge = (i: number): boolean => !!held[i] && !this.prev[i]
    const has = (i: number): boolean => !!held[i]

    // d-pad folds into movement (binary, keyboard-equivalent)
    let dx = 0
    let dy = 0
    if (has(BTN.DLEFT)) dx -= 1
    if (has(BTN.DRIGHT)) dx += 1
    if (has(BTN.DUP)) dy -= 1
    if (has(BTN.DDOWN)) dy += 1
    if (dx !== 0 || dy !== 0) {
      snap.move.x += dx * 0.92
      snap.move.y += dy * 0.92
      const mm = Math.hypot(snap.move.x, snap.move.y)
      if (mm > 1) {
        snap.move.x /= mm
        snap.move.y /= mm
      }
      snap.lastInputAt = performance.now()
    }

    // fire cluster — held
    snap.fire = has(BTN.RT) || has(BTN.RB) || has(BTN.LT) || has(BTN.A)
    if (snap.fire) snap.lastInputAt = performance.now()

    // edges
    snap.a = edge(BTN.A)
    snap.b = edge(BTN.B)
    snap.x = edge(BTN.X)
    snap.y = edge(BTN.Y)
    snap.lb = edge(BTN.LB)
    snap.rb = edge(BTN.RB)
    snap.lt = edge(BTN.LT)
    snap.rt = edge(BTN.RT)
    snap.start = edge(BTN.START)
    snap.back = edge(BTN.BACK)
    snap.l3 = edge(BTN.L3)
    snap.r3 = edge(BTN.R3)
    snap.anyEdge =
      snap.a ||
      snap.b ||
      snap.x ||
      snap.y ||
      snap.lb ||
      snap.rb ||
      snap.lt ||
      snap.rt ||
      snap.start ||
      snap.back ||
      snap.l3 ||
      snap.r3
    if (snap.anyEdge) snap.lastInputAt = performance.now()

    this.prev = held
    return snap
  }

  /**
   * Fire a dual-rumble effect. Throttled for small pulses (rapid kill
   * feedback becomes a smooth buzz); strong events (>= 0.7) always cut
   * through so hits and deaths are never swallowed.
   */
  rumble(strong: number, weak: number, durationMs: number): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return
    const s = Math.min(1, Math.max(0, strong))
    const w = Math.min(1, Math.max(0, weak))
    if (s <= 0 && w <= 0) return
    const now = performance.now()
    const strongEvent = s >= 0.7
    if (!strongEvent && now - this.lastRumbleAt < RUMBLE_MIN_GAP_MS) return
    this.lastRumbleAt = now

    const pad = firstPad()
    const actuator = (
      pad as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<string> } }) | null
    )?.vibrationActuator
    if (!actuator) return
    try {
      actuator.playEffect('dual-rumble', { duration: durationMs, strongMagnitude: s, weakMagnitude: w }).catch(
        () => {
          /* unsupported / interrupted — ignore */
        },
      )
    } catch {
      /* older browsers throw synchronously — ignore */
    }
  }
}

/**
 * React-friendly connection watcher for UI badges.
 * Fires immediately with the current state, then on every connect/disconnect.
 */
export function subscribeGamepads(cb: (connected: boolean, id: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const fire = (): void => {
    const pad = firstPad()
    cb(!!pad, pad ? cleanId(pad.id) : '')
  }
  window.addEventListener('gamepadconnected', fire)
  window.addEventListener('gamepaddisconnected', fire)
  fire()
  return () => {
    window.removeEventListener('gamepadconnected', fire)
    window.removeEventListener('gamepaddisconnected', fire)
  }
}
