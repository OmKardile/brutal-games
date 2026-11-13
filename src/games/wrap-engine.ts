// Shared engine-wrapper ("shim") core.
//
// Wraps an EXISTING engine instance (src/game/* — never edited) into the
// game-kit contract { start, pause, resume, destroy } with:
//
//  - daily seed injection: while a seeded run is active, Math.random is
//    patched to a seeded mulberry32 stream so spawn sequences match the day's
//    seed for everyone. PARTIAL determinism, deliberately documented: the
//    engines own their rAF loops with variable dt, so "same seed + same
//    inputs ⇒ bit-identical run" is only guaranteed for kit-native games.
//    Full migration of the engines onto the kit loop is proposed separately.
//
//  - pause/resume via rAF gating: engines re-register one rAF callback per
//    frame; while paused the callback is held instead of scheduled. Engines
//    clamp their own dt after long gaps (verified per engine), so resume is
//    safe. window.requestAnimationFrame is restored on destroy.
//
//  - adapter signals: phase transitions drive gameplayStart/gameplayStop
//    through the rule-enforced adapter (starting a run requires player input,
//    so "start only on first input" holds; rules make doubles no-ops anyway).

import { mulberry32, type GameHandle, type GameCtx, type KitPhase, type RunSummary } from '@/game-kit'

export interface WrapOptions<E> {
  /** engine phase string that means a run started (seed inject + gameplayStart) */
  playingPhase: string
  /** engine phase strings that mean a run ended (seed restore + gameplayStop) */
  overPhases: string[]
  /** engine phase strings that mean gameplay paused (gameplayStop too) */
  pausedPhases?: string[]
  /** map the engine's stats object to the normalized RunSummary */
  summary: (stats: unknown) => RunSummary
  start: (engine: E) => void
  destroy: (engine: E) => void
  setTheme?: (engine: E, mode: 'night' | 'day') => void
  setMuted?: (engine: E, muted: boolean) => void
}

export interface EngineHandle<E> extends GameHandle {
  engine: E
  setTheme(mode: 'night' | 'day'): void
  setMuted(muted: boolean): void
}

export function wrapEngine<E>(ctx: GameCtx, engine: E, opts: WrapOptions<E>): EngineHandle<E> {
  // ---- rAF gating ---------------------------------------------------------
  const origRaf = window.requestAnimationFrame.bind(window)
  let gated = false
  let held: FrameRequestCallback | null = null
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    if (gated) {
      held = cb
      return 0
    }
    return origRaf(cb)
  }) as typeof window.requestAnimationFrame

  const releaseHeld = (): void => {
    const cb = held
    held = null
    if (cb) origRaf(cb)
  }

  // ---- seed injection -----------------------------------------------------
  const realRandom = Math.random
  let seeded = false
  const injectSeed = (): void => {
    if (seeded || !ctx.daily) return
    seeded = true
    const rng = mulberry32(ctx.daily.seed)
    Math.random = rng
  }
  const restoreSeed = (): void => {
    if (!seeded) return
    seeded = false
    Math.random = realRandom
  }

  // ---- run clock + adapter signals ----------------------------------------
  let runStartedAt = 0
  let started = false

  const handlePhase = (phase: string): void => {
    if (phase === opts.playingPhase) {
      injectSeed()
      runStartedAt = performance.now()
      ctx.adapter.gameplayStart()
      started = true
    } else if (opts.overPhases.includes(phase)) {
      restoreSeed()
      if (started) {
        ctx.adapter.gameplayStop()
        started = false
      }
    } else if (opts.pausedPhases?.includes(phase)) {
      if (started) {
        ctx.adapter.gameplayStop()
        started = false
      }
    } else if (phase === 'menu' || phase === 'idle') {
      // back to menu — a paused/menu state after a run
      restoreSeed()
      if (started) {
        ctx.adapter.gameplayStop()
        started = false
      }
    }
  }

  /** the per-game shim calls this for EVERY raw engine event */
  const forward = (ev: { type: string; phase?: string; stats?: unknown }): void => {
    if (ev.type === 'phase' && typeof ev.phase === 'string') {
      handlePhase(ev.phase)
      ctx.events.onPhase?.(kitPhase(ev.phase, opts))
    } else if (ev.type === 'gameover' && ev.stats != null) {
      const base = opts.summary(ev.stats)
      // duration: prefer the shim's wall clock; engines' own notion wins for
      // arena (timeAlive) via opts.summary already setting durationMs
      if (runStartedAt > 0 && base.durationMs <= 0) {
        base.durationMs = Math.round(performance.now() - runStartedAt)
      }
      ctx.events.onGameOver?.(base)
    }
    ctx.events.onGameEvent?.(ev)
  }

  const handle: EngineHandle<E> = {
    engine,
    start(): void {
      opts.start(engine)
    },
    pause(): void {
      gated = true
      // a paused game shows no motion and must not accrue time
    },
    resume(): void {
      gated = false
      releaseHeld()
    },
    destroy(): void {
      restoreSeed()
      gated = false
      held = null
      window.requestAnimationFrame = origRaf
      if (started) {
        ctx.adapter.gameplayStop()
        started = false
      }
      opts.destroy(engine)
    },
    setTheme(mode: 'night' | 'day'): void {
      opts.setTheme?.(engine, mode)
    },
    setMuted(muted: boolean): void {
      opts.setMuted?.(engine, muted)
    },
    // internal tap for the shim's event forwarder
    ...(process.env.NODE_ENV === 'development' ? {} : {}),
  }

  return withForward(handle, forward)
}

function kitPhase<E>(phase: string, opts: WrapOptions<E>): KitPhase {
  if (phase === opts.playingPhase) return 'playing'
  if (opts.overPhases.includes(phase)) return 'gameover'
  if (opts.pausedPhases?.includes(phase)) return 'paused'
  return 'menu'
}

// expose `forward` on the handle for the per-game shims (kept off the public
// GameHandle surface via a symbol-free duck-typed property)
type Forwardable = { __forward?: (ev: { type: string; phase?: string; stats?: unknown }) => void }

function withForward<E>(handle: EngineHandle<E>, forward: Forwardable['__forward']): EngineHandle<E> {
  ;(handle as EngineHandle<E> & Forwardable).__forward = forward
  return handle
}

/** Shims use this to feed raw engine events into the wrapper. */
export function forwardEngineEvent(
  handle: EngineHandle<unknown>,
  ev: { type: string; phase?: string; stats?: unknown },
): void {
  ;(handle as Forwardable).__forward?.(ev)
}
