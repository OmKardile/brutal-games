// STACK engine shim — StackGame wrapped into the kit contract.
// Phases: idle (menu) | playing | over. One-tap instant retry via start().
//
// Daily mutators (roadmap slice 1): the mutator rides ctx.daily (derived
// server-side from the same seed hash family — zero client trust). The
// score transform lives HERE in summary() so the submitted score already
// carries the mutator math; the engine is untouched.

import { StackGame, type StackEvent, type StackStats } from '@/game/stack'
import type { GameCtx, RunSummary } from '@/game-kit'
import { forwardEngineEvent, wrapEngine, type EngineHandle } from '../wrap-engine'
import { applyMutator } from '@/lib/daily/mutators'

export function createGame(ctx: GameCtx): EngineHandle<StackGame> {
  const handleRef: { current?: EngineHandle<StackGame> } = {}

  const engine = new StackGame(ctx.canvas, (ev: StackEvent) => {
    if (handleRef.current) forwardEngineEvent(handleRef.current, ev)
  })

  const handle = wrapEngine(ctx, engine, {
    playingPhase: 'playing',
    overPhases: ['over'],
    summary: (stats): RunSummary => {
      const s = stats as StackStats
      // mutator transform on daily runs; casual runs are classic scoring
      const mutatorId = ctx.daily?.mutator ?? 'none'
      const score = applyMutator(mutatorId, {
        score: s.score,
        perfects: s.perfects,
        bestStreak: s.bestStreak,
      })
      return {
        score,
        wave: s.score, // height for the board
        kills: s.perfects, // perfect drops
        durationMs: 0, // wall clock filled by the wrapper
        extra: { perfects: s.perfects, bestStreak: s.bestStreak },
      }
    },
    start: (e) => e.start(),
    destroy: (e) => e.destroy(),
    setTheme: (e, mode) => e.setTheme(mode),
    setMuted: (e, muted) => e.setMuted(muted),
  })

  handleRef.current = handle
  return handle
}
