// DODGE engine shim — DodgeGame wrapped into the kit contract.
// Phases: idle | playing | over.

import { DodgeGame, type DodgeEvent, type DodgeStats } from '@/game/dodge'
import type { GameCtx, RunSummary } from '@/game-kit'
import { forwardEngineEvent, wrapEngine, type EngineHandle } from '../wrap-engine'

export function createGame(ctx: GameCtx): EngineHandle<DodgeGame> {
  const handleRef: { current?: EngineHandle<DodgeGame> } = {}

  const engine = new DodgeGame(ctx.canvas, (ev: DodgeEvent) => {
    if (handleRef.current) forwardEngineEvent(handleRef.current, ev)
  })

  const handle = wrapEngine(ctx, engine, {
    playingPhase: 'playing',
    overPhases: ['over'],
    summary: (stats): RunSummary => {
      const s = stats as DodgeStats
      return {
        score: s.score,
        wave: Math.floor(s.distance),
        kills: s.orbs,
        durationMs: 0,
        extra: { distance: s.distance, orbs: s.orbs, nearMisses: s.nearMisses },
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
