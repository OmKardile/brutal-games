// STACK engine shim — StackGame wrapped into the kit contract.
// Phases: idle (menu) | playing | over. One-tap instant retry via start().

import { StackGame, type StackEvent, type StackStats } from '@/game/stack'
import type { GameCtx, RunSummary } from '@/game-kit'
import { forwardEngineEvent, wrapEngine, type EngineHandle } from '../wrap-engine'

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
      return {
        score: s.score,
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
