// Runner props — the contract between a game runner (src/games/<slug>/page.tsx)
// and the portal GameStage that hosts it.

import type { RunSummary, PortalAdapter } from '@/game-kit'

/** seeded daily challenge info (null for casual runs) */
export interface DailyInfo {
  dateKey: string
  seed: number
  /** false when the client fell back to a local seed (offline / API absent) */
  ranked: boolean
}

export interface StageProps {
  daily?: DailyInfo | null
  /**
   * Raw (unwrapped) portal adapter owned by the stage. The runner's buildCtx
   * wraps it in the enforced rules; the stage keeps this handle for analytics
   * events (game_load / run_end / daily_* / share_click).
   */
  adapter?: PortalAdapter
  onPhase?: (phase: 'menu' | 'playing' | 'paused' | 'gameover') => void
  onRunEnd?: (summary: RunSummary) => void
  /** poster is gone, canvas is live — GameStage hides the loader */
  onReady?: () => void
}
