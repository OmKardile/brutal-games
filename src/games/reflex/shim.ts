// REFLEX engine shim — ReflexGame wrapped into the kit contract.
// Phases: idle | playing | over.

import { ReflexGame, type ReflexEvent, type ReflexStats } from '@/game/reflex'
import type { GameCtx, RunSummary } from '@/game-kit'
import { forwardEngineEvent, wrapEngine, type EngineHandle } from '../wrap-engine'

export function createGame(ctx: GameCtx): EngineHandle<ReflexGame> {
  const handleRef: { current?: EngineHandle<ReflexGame> } = {}

  const engine = new ReflexGame(ctx.canvas, (ev: ReflexEvent) => {
    if (handleRef.current) forwardEngineEvent(handleRef.current, ev)
  })

  const handle = wrapEngine(ctx, engine, {
    playingPhase: 'playing',
    overPhases: ['over'],
    summary: (stats): RunSummary => {
      const s = stats as ReflexStats
      return {
        score: s.score,
        wave: s.hits,
        kills: s.perfects,
        durationMs: 0,
        extra: { hits: s.hits, perfects: s.perfects, bestStreak: s.bestStreak },
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
