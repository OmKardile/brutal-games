// game-kit/adapter — CrazyGames adapter STUB (not active).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ DO NOT "finish" this stub from memory. Before activating CrazyGames,   │
// │ read the official SDK documentation (https://docs.crazygames.com) and   │
// │ verify every method name and signature against the CURRENT SDK         │
// │ version (the CrazyGames SDK has its own event names — sdk.game.        │
// │ gameplayStart(), requestMidgameAd, requestRewardedAd… — verify, don't   │
// │ guess).                                                                │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Safe-default stub implementing OUR PortalAdapter contract; logs what WOULD
// be forwarded. Activation checklist mirrors the Poki one:
//   1. Read https://docs.crazygames.com — SDK include, init/environment,
//      gameplay events, ad request APIs, loading signals, QA tooling.
//   2. Map each verified SDK call into the methods below.
//   3. Load the SDK script in init() ONLY (never in game code).
//   4. Run the QA.md portability checklist.

import type { AdResult, PortalAdapter } from './types'

const TAG = '[crazygames-stub]'

export class CrazyGamesAdapterStub implements PortalAdapter {
  async init(): Promise<void> {
    console.info(`${TAG} init() — load the CrazyGames SDK here after verifying docs`)
  }

  loadingFinished(): void {
    console.info(`${TAG} loadingFinished() → SDK loading-completed signal`)
  }

  gameplayStart(): void {
    console.info(`${TAG} gameplayStart() → sdk.game.gameplayStart()`)
  }

  gameplayStop(): void {
    console.info(`${TAG} gameplayStop() → sdk.game.gameplayStop()`)
  }

  async showInterstitial(opts: { naturalBreak: boolean }): Promise<AdResult> {
    console.info(`${TAG} requestMidgameAd (naturalBreak=${opts.naturalBreak})`)
    return { shown: false, reason: 'stub' }
  }

  async showRewarded(): Promise<AdResult> {
    console.info(`${TAG} requestRewardedAd`)
    return { shown: false, reason: 'stub' }
  }

  trackEvent(name: string, data?: unknown): void {
    console.info(`${TAG} trackEvent(${String(name)})`, data ?? {})
  }
}
