// game-kit/adapter — OwnPortalAdapter: our site's adapter.
//
// Responsibilities:
//  - analytics events (fixed vocabulary, see types.ts) → an optional
//    privacy-friendly endpoint (Plausible/Umami-style) set via
//    NEXT_PUBLIC_ANALYTICS_ENDPOINT. Uses sendBeacon (fire-and-forget, no
//    blocking, dies silently offline). When no endpoint is configured, events
//    are dropped in production and logged in development — nothing is stored
//    locally, ever.
//  - lifecycle signals for our own portal (play_start / game_load / run_end).
//  - rewards integration is INDIRECT and engagement-based only: the game host
//    (GameStage) drives the RewardsHud heartbeat from the same phase
//    transitions that call gameplayStart/Stop. This adapter never mentions
//    ads to anything rewards-related, and rewarded ads never grant points.
//
// Ad serving: no network is wired yet. showInterstitial/showRewarded resolve
// as not-shown immediately; the rule wrapper still enforces caps so the day a
// network is connected, nothing has to change in game code.

import type { AdResult, AnalyticsEventData, AnalyticsEventName, PortalAdapter } from './types'

const DEV = typeof process !== 'undefined' && process.env.NODE_ENV === 'development'

export interface OwnPortalOptions {
  /** absolute URL of a Plausible/Umami-style event collector (env-injected) */
  analyticsEndpoint?: string
  /** site id some collectors require */
  analyticsSite?: string
}

export class OwnPortalAdapter implements PortalAdapter {
  private readonly endpoint: string | undefined
  private readonly site: string | undefined

  constructor(opts: OwnPortalOptions = {}) {
    this.endpoint =
      opts.analyticsEndpoint ?? (process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT || undefined)
    this.site = opts.analyticsSite ?? (process.env.NEXT_PUBLIC_ANALYTICS_SITE || undefined)
  }

  async init(): Promise<void> {
    // nothing to fetch — the arcade ships no third-party scripts.
    // (When an ad network is approved: load its script HERE only, never in
    // game code, behind the same enforced rules — see rules.ts.)
  }

  loadingFinished(): void {
    this.trackEvent('game_load')
  }

  gameplayStart(): void {
    this.trackEvent('play_start')
  }

  gameplayStop(): void {
    // the following run_end event carries the stats; play_stop carries none
  }

  async showInterstitial(_opts: { naturalBreak: boolean }): Promise<AdResult> {
    // no ad network yet — the game continues immediately
    return { shown: false, reason: 'no-network' }
  }

  async showRewarded(): Promise<AdResult> {
    return { shown: false, reason: 'no-network' }
  }

  trackEvent(name: AnalyticsEventName, data?: AnalyticsEventData): void {
    if (!this.endpoint) {
      if (DEV) console.debug('[analytics]', name, data ?? {})
      return
    }
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return
    try {
      const body = JSON.stringify({
        name,
        ...(this.site ? { site: this.site } : {}),
        ...(data ?? {}),
        ts: Date.now(),
      })
      navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }))
    } catch {
      // analytics must never break the game
    }
  }
}
