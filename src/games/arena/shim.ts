// ARENA engine shim — BrutalGame wrapped into the kit contract.
// Engine file src/game/engine.ts is NEVER edited; everything happens here.
//
// ARENA specifics: the engine boots into its own attract-mode menu, so
// start() kicks a run via startRun() (+ audio unlock). Phases: menu |
// playing | upgrade | paused | gameover — upgrade drafts and pause are
// mid-run (heartbeat keeps running per RewardsHud semantics).

import { BrutalGame } from '@/game/engine'
import type { GameEvent, RunStats } from '@/game/types'
import type { GameCtx, RunSummary } from '@/game-kit'
import { forwardEngineEvent, wrapEngine, type EngineHandle } from '../wrap-engine'

export function createGame(ctx: GameCtx): EngineHandle<BrutalGame> {
  // engines only emit from their rAF loop, but the ref makes that a guarantee
  // instead of an assumption
  const handleRef: { current?: EngineHandle<BrutalGame> } = {}

  const engine = new BrutalGame(ctx.canvas, (ev: GameEvent) => {
    if (handleRef.current) forwardEngineEvent(handleRef.current, ev)
  })

  const handle = wrapEngine(ctx, engine, {
    playingPhase: 'playing',
    overPhases: ['gameover', 'menu'],
    // 'upgrade' drafts and 'paused' are mid-run: the kit reports them as
    // 'paused' (heartbeat session stays open; the portal gets its natural
    // break via gameplayStop)
    pausedPhases: ['paused', 'upgrade'],
    summary: (stats): RunSummary => {
      const s = stats as RunStats
      return {
        score: s.score,
        wave: s.wave,
        kills: s.kills,
        durationMs: Math.round(s.timeAlive * 1000),
        extra: {
          maxCombo: s.maxCombo,
          bossesKilled: s.bossesKilled,
          overdrivesUsed: s.overdrivesUsed,
          eliteKills: s.eliteKills,
        },
      }
    },
    start: (e) => {
      e.unlockAudio()
      e.startRun()
    },
    destroy: (e) => e.destroy(),
    setTheme: (e, mode) => e.setTheme(mode),
    setMuted: (e, muted) => e.setMuted(muted),
  })

  handleRef.current = handle
  return handle
}
