// game-kit/adapter — the PortalAdapter contract.
//
// ONE interface for everything a game/host may ask of the outside world:
// lifecycle signals, ads, analytics. Games never touch an SDK directly; the
// portal build swaps the adapter (Noop / OwnPortal / Poki / CrazyGames) without
// touching game code. That keeps game packages portable and keeps the hard
// platform rules enforceable in exactly one place (rules.ts).

/** Analytics vocabulary — fixed names so dashboards stay stable. */
export type AnalyticsEventName =
  | 'game_load' // the game module finished loading (poster → playable)
  | 'play_start' // first real input of a session started gameplay
  | 'run_end' // a run finished (score, durationMs, game)
  | 'daily_start' // a daily-challenge run started (game, dateKey)
  | 'daily_complete' // a daily-challenge run finished (score, ranked)
  | 'share_click' // player hit share (game)
  | 'ad_shown' // an interstitial or rewarded ad actually showed
  | 'ad_failed' // an ad errored or timed out (game continued)

export interface AnalyticsEventData {
  game?: string
  score?: number
  durationMs?: number
  dateKey?: string
  ranked?: boolean
  adKind?: 'interstitial' | 'rewarded'
  reason?: string
  [key: string]: unknown
}

/** Result of an ad request. `shown:false` means "no ad — continue the game". */
export interface AdResult {
  shown: boolean
  /** why no ad was shown (cap, cooldown, no fill, error…) */
  reason?: string
}

export interface PortalAdapter {
  /** called once before the game loads; may prefetch SDKs */
  init(): Promise<void>
  /** the game is interactive — poster can hide */
  loadingFinished(): void
  /**
   * gameplay started. Hosts call this ONLY on the first real player input of a
   * run — never on page load (rules.ts makes violations no-ops).
   */
  gameplayStart(): void
  /** gameplay interrupted: pause, menu, level end, game over. */
  gameplayStop(): void
  /**
   * Interstitial ad. Only valid at a natural break (game over / level end /
   * menu). Enforced: min gap (default 90s), nothing in the first session
   * minute, never during play, never during another ad, 5s timeout then the
   * game continues, always pause + mute around it.
   */
  showInterstitial(opts: { naturalBreak: boolean }): Promise<AdResult>
  /**
   * Rewarded ad (player-initiated). A `shown:true` result grants an IN-GAME
   * perk ONLY (extra life, retry). NEVER reward-program points — points come
   * exclusively from the engagement-based rewards pipeline.
   */
  showRewarded(): Promise<AdResult>
  /** analytics event */
  trackEvent(name: AnalyticsEventName, data?: AnalyticsEventData): void
}
