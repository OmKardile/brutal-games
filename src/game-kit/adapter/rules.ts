// game-kit/adapter — the ENFORCED rules for gameplay signals and ads.
//
// Games can't bypass these: `createRuleEnforcedAdapter` wraps any PortalAdapter
// and every call passes through this state machine first. The wrapped adapter
// is the ONLY one the game host ever holds.
//
//  - gameplayStart: only when stopped and never during an ad. Calling it on
//    load (before input) is the host's bug — here it's a no-op.
//  - gameplayStop: only when playing; never back-to-back. A stop requested
//    during an ad is queued and applied when the ad finishes.
//  - interstitials: natural breaks only, never during play or another ad,
//    minimum gap (default 90s), none in the first session minute.
//  - every ad: pause + mute hooks fire before, release after. Ad promise gets
//    5s to resolve — then the game continues regardless (never block).
//  - ad failure is an event (ad_failed), never an exception into game code.

import type { AdResult, PortalAdapter } from './types'

export interface AdRulesConfig {
  /** minimum distance between interstitials (default 90_000) */
  minGapMs?: number
  /** no interstitial before this much session time passed (default 60_000) */
  noAdFirstMs?: number
  /** an ad that takes longer than this is abandoned — game continues (default 5_000) */
  adTimeoutMs?: number
}

export type GameplayState = 'stopped' | 'playing'
export type InterstitialVerdict = { ok: true } | { ok: false; reason: string }

/** Pure rule state machine — unit-tested without any adapter or DOM. */
export class AdRules {
  private sessionStart = 0
  private lastAdAt: number | null = null
  private gameplay: GameplayState = 'stopped'
  private inAd = false
  private stopQueued = false
  private readonly minGapMs: number
  private readonly noAdFirstMs: number
  readonly adTimeoutMs: number

  constructor(config: AdRulesConfig = {}) {
    this.minGapMs = config.minGapMs ?? 90_000
    this.noAdFirstMs = config.noAdFirstMs ?? 60_000
    this.adTimeoutMs = config.adTimeoutMs ?? 5_000
  }

  /** (Re)start the session clock — call when the adapter is created. */
  begin(now = Date.now()): void {
    this.sessionStart = now
    this.lastAdAt = null
    this.gameplay = 'stopped'
    this.inAd = false
    this.stopQueued = false
  }

  get gameplayState(): GameplayState {
    return this.gameplay
  }

  get adActive(): boolean {
    return this.inAd
  }

  /** May gameplay start now? Only from 'stopped', never mid-ad. */
  canGameplayStart(): boolean {
    return this.gameplay === 'stopped' && !this.inAd
  }

  noteGameplayStarted(): void {
    if (this.canGameplayStart()) this.gameplay = 'playing'
  }

  /**
   * May gameplay stop now? Only from 'playing'. If an ad is showing, the stop
   * is queued and flushed when the ad ends (never dropped, never doubled).
   */
  requestGameplayStop(): boolean {
    if (this.inAd) {
      this.stopQueued = true
      return false
    }
    if (this.gameplay === 'playing') {
      this.gameplay = 'stopped'
      return true
    }
    return false // already stopped — never back-to-back
  }

  /** May an interstitial show at this moment? */
  canShowInterstitial(naturalBreak: boolean, now = Date.now()): InterstitialVerdict {
    if (this.inAd) return { ok: false, reason: 'ad-active' }
    if (this.gameplay === 'playing') return { ok: false, reason: 'during-play' }
    if (!naturalBreak) return { ok: false, reason: 'not-a-natural-break' }
    if (now - this.sessionStart < this.noAdFirstMs) return { ok: false, reason: 'first-minute' }
    if (this.lastAdAt !== null && now - this.lastAdAt < this.minGapMs) {
      return { ok: false, reason: 'frequency-cap' }
    }
    return { ok: true }
  }

  noteAdStart(): void {
    this.inAd = true
  }

  noteAdEnd(shown: boolean, now = Date.now()): void {
    this.inAd = false
    if (shown) this.lastAdAt = now
    if (this.stopQueued) {
      this.stopQueued = false
      this.requestGameplayStop()
    }
  }
}

export interface EnforcedAdapterHooks {
  /** fire before an ad shows: host MUST pause the game and mute audio */
  onAdStart?: () => void
  /** fire after an ad settles (shown, failed, timed out): host resumes */
  onAdEnd?: () => void
}

/**
 * Wrap any adapter in the enforced rules. This is the adapter games get.
 * The pure rule object is exposed for tests and for the host's QA overlay.
 */
export function createRuleEnforcedAdapter(
  base: PortalAdapter,
  config: AdRulesConfig = {},
  hooks: EnforcedAdapterHooks = {},
): PortalAdapter & { rules: AdRules } {
  const rules = new AdRules(config)

  const runAd = async (
    kind: 'interstitial' | 'rewarded',
    run: () => Promise<AdResult>,
    allowed: () => InterstitialVerdict,
  ): Promise<AdResult> => {
    const verdict = allowed()
    if (!verdict.ok) {
      base.trackEvent('ad_failed', { adKind: kind, reason: verdict.reason })
      return { shown: false, reason: verdict.reason }
    }
    rules.noteAdStart()
    hooks.onAdStart?.()
    let result: AdResult
    try {
      result = await Promise.race([
        run(),
        new Promise<AdResult>((resolve) =>
          setTimeout(() => resolve({ shown: false, reason: 'timeout' }), rules.adTimeoutMs),
        ),
      ])
    } catch {
      result = { shown: false, reason: 'error' }
    }
    rules.noteAdEnd(result.shown)
    hooks.onAdEnd?.()
    if (result.shown) base.trackEvent('ad_shown', { adKind: kind })
    else base.trackEvent('ad_failed', { adKind: kind, reason: result.reason ?? 'no-fill' })
    return result
  }

  const wrapped: PortalAdapter & { rules: AdRules } = {
    async init() {
      rules.begin()
      await base.init()
    },
    loadingFinished() {
      base.loadingFinished()
    },
    gameplayStart() {
      if (!rules.canGameplayStart()) return // never on load, never mid-ad, never doubled
      rules.noteGameplayStarted()
      base.gameplayStart()
    },
    gameplayStop() {
      if (!rules.requestGameplayStop()) return // never back-to-back, queued during ads
      base.gameplayStop()
    },
    showInterstitial(opts: { naturalBreak: boolean }) {
      return runAd('interstitial', () => base.showInterstitial(opts), () =>
        rules.canShowInterstitial(opts.naturalBreak),
      )
    },
    showRewarded() {
      // rewarded ads are player-initiated: no frequency cap, but still
      // pause + mute + timeout, and never during another ad.
      return runAd('rewarded', () => base.showRewarded(), () =>
        rules.adActive ? { ok: false, reason: 'ad-active' } : { ok: true },
      )
    },
    trackEvent(name, data) {
      base.trackEvent(name, data)
    },
    rules,
  }
  return wrapped
}
