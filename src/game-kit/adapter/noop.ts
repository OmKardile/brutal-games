// game-kit/adapter — NoopAdapter: the default everywhere.
//
// No ads, no analytics, no SDK. Every method is a safe no-op so games run
// unchanged in dev, in tests, and on our own portal before any ad network
// exists. Ads resolve immediately as not-shown — the game always continues.

import type { AdResult, PortalAdapter } from './types'

export class NoopAdapter implements PortalAdapter {
  async init(): Promise<void> {
    /* nothing to initialize */
  }

  loadingFinished(): void {
    /* nothing */
  }

  gameplayStart(): void {
    /* nothing */
  }

  gameplayStop(): void {
    /* nothing */
  }

  async showInterstitial(_opts: { naturalBreak: boolean }): Promise<AdResult> {
    return { shown: false, reason: 'noop' }
  }

  async showRewarded(): Promise<AdResult> {
    return { shown: false, reason: 'noop' }
  }

  trackEvent(): void {
    /* nothing */
  }
}
