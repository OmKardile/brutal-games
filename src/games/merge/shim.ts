// MERGE engine shim — MergeGame wrapped into the kit contract.
// Phases: idle | playing | over.

import { MergeGame, type MergeEvent, type MergeStats } from '@/game/merge'
import type { GameCtx, RunSummary } from '@/game-kit'
import { forwardEngineEvent, wrapEngine, type EngineHandle } from '../wrap-engine'

export function createGame(ctx: GameCtx): EngineHandle<MergeGame> {
  const handleRef: { current?: EngineHandle<MergeGame> } = {}

  const engine = new MergeGame(ctx.canvas, (ev: MergeEvent) => {
    if (handleRef.current) forwardEngineEvent(handleRef.current, ev)
  })

  const handle = wrapEngine(ctx, engine, {
    playingPhase: 'playing',
    overPhases: ['over'],
    summary: (stats): RunSummary => {
      const s = stats as MergeStats
      return {
        score: s.score,
        wave: s.merges,
        kills: s.merges,
        durationMs: 0,
        extra: {
          merges: s.merges,
          highestTier: s.highestTier,
          bestCombo: s.bestCombo,
          singularities: s.singularities,
        },
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
