// game-kit — the game package contract.
//
// A game package (src/games/<slug>/) exports a manifest and a createGame(ctx)
// factory. The HOST (GameStage) builds the ctx, creates the game through this
// contract, and drives the adapter rules. Games receive everything they need
// through ctx and must make ZERO direct requests (no ads, no analytics, no
// fetch) — that's the portability invariant for Poki/CrazyGames submission.
//
// The existing engines in src/game/* are wrapped by shims that implement this
// contract around them — the engines themselves are untouched.

import type { GameThemeMode } from '../game/theme'
import type { PortalAdapter } from './adapter/types'
import { createRuleEnforcedAdapter, type AdRules, type AdRulesConfig } from './adapter/rules'
import { NoopAdapter } from './adapter/noop'
import { OwnPortalAdapter } from './adapter/own'
import { AudioHost } from './audio'
import { UnifiedInput } from './input'
import type { RngKit } from './rng'

// ---------------------------------------------------------------- contracts

/** Normalized run stats — the only shape the portal knows. */
export interface RunSummary {
  score: number
  wave: number
  kills: number
  /** wall-clock ms from run start to game over (client-measured, server-checked) */
  durationMs: number
  /** game-specific extras (perfects, closes, merges…) for boards/UI */
  extra?: Record<string, number>
}

export type KitPhase = 'menu' | 'playing' | 'paused' | 'gameover'

export interface GameEvents {
  onPhase?: (phase: KitPhase) => void
  /** final stats of a finished run */
  onGameOver?: (summary: RunSummary) => void
  /** raw engine-specific events (typed by the game package, passthrough) */
  onGameEvent?: (ev: unknown) => void
}

/** Everything a game may touch. Nothing else exists to it. */
export interface GameCtx {
  canvas: HTMLCanvasElement
  /** seeded rng kit, or null in casual runs (game may use Math.random then) */
  rng: RngKit | null
  /** current theme mode + live updates (wrapped engines call their own setTheme) */
  theme: () => GameThemeMode
  onThemeChange: (cb: (mode: GameThemeMode) => void) => () => void
  audio: AudioHost
  input: UnifiedInput
  /** the rule-enforced portal adapter — the only door to the outside world */
  adapter: PortalAdapter & { rules: AdRules }
  /** set when this run is a daily challenge (seeded, same for everyone) */
  daily: { dateKey: string; seed: number; ranked: boolean } | null
  /** server-configured portal rules (ad gap etc.) */
  adRules: AdRulesConfig
  events: GameEvents
}

/** What a game package returns. pause/resume must be safe to call any time. */
export interface GameHandle {
  start(): void
  pause(): void
  resume(): void
  destroy(): void
}

export type CreateGame = (ctx: GameCtx) => GameHandle

// ---------------------------------------------------------------- host helpers

export interface BuildCtxOptions {
  canvas: HTMLCanvasElement
  /** 'own' for this site, 'noop' for tests/offline */
  adapterKind?: 'own' | 'noop'
  adapter?: PortalAdapter // override with a fully-built adapter (tests)
  theme: () => GameThemeMode
  onThemeChange: (cb: (mode: GameThemeMode) => void) => () => void
  daily?: { dateKey: string; seed: number; ranked: boolean } | null
  adRules?: AdRulesConfig
  events?: GameEvents
}

/**
 * Assemble a GameCtx (input + audio + adapter) for a canvas. The caller owns
 * the returned pieces' lifetimes via ctx — call input.detach() and
 * audio.destroy() when the stage unmounts (or use destroyCtx()).
 */
export function buildCtx(opts: BuildCtxOptions): GameCtx {
  const input = new UnifiedInput(opts.canvas)
  input.attach()

  const base =
    opts.adapter ??
    (opts.adapterKind === 'noop' ? new NoopAdapter() : new OwnPortalAdapter())
  const adapter = createRuleEnforcedAdapter(base, opts.adRules ?? {}, {
    // pause+mute around ads is enforced centrally; the stage also listens to
    // visibility via its own PauseManager — the audio host mutes on blur too.
  })

  return {
    canvas: opts.canvas,
    rng: null, // seeded by the host for daily runs (shims read ctx.daily.seed)
    theme: opts.theme,
    onThemeChange: opts.onThemeChange,
    audio: new AudioHost(),
    input,
    adapter,
    daily: opts.daily ?? null,
    adRules: opts.adRules ?? {},
    events: opts.events ?? {},
  }
}

/** Tear down the host-owned pieces of a ctx. */
export function destroyCtx(ctx: GameCtx): void {
  ctx.input.detach()
  ctx.audio.destroy()
}

// ---------------------------------------------------------------- re-exports

export type {
  AdResult,
  AnalyticsEventData,
  AnalyticsEventName,
  PortalAdapter,
} from './adapter/types'
export { AdRules, createRuleEnforcedAdapter, type AdRulesConfig } from './adapter/rules'
export { NoopAdapter } from './adapter/noop'
export { OwnPortalAdapter } from './adapter/own'
export { PokiAdapterStub } from './adapter/poki'
export { CrazyGamesAdapterStub } from './adapter/crazy'
export { GameLoop, PauseManager, type LoopOptions, type PauseReason } from './loop'
export { UnifiedInput, type PointerState, type FirstInputEvent } from './input'
export { CanvasScaler, safeAreaInsets, type CanvasMetrics, type ScalerOptions } from './canvas'
export { AudioHost } from './audio'
export {
  safeLocal,
  safeSession,
  getJson,
  setJson,
  getInt,
  setInt,
  type SafeStorage,
} from './storage'
export {
  hashString,
  mulberry32,
  rngRange,
  rngInt,
  rngPick,
  rngChance,
  createRngKit,
  createRngKitFromString,
  type RngKit,
  type RngStream,
} from './rng'
export {
  TraumaShake,
  ParticleSystem,
  Tweens,
  HitStop,
  prefersReducedMotion,
  easeOutCubic,
  easeInCubic,
  easeOutBack,
  easeInOutQuad,
  easeOutElastic,
  type Particle,
  type ParticleOpts,
  type EaseFn,
} from './juice'
export { Pool } from './pool'
export { PerfOverlay } from './perf'
export { createInputRecorder, type InputRecorder } from './input-log'
