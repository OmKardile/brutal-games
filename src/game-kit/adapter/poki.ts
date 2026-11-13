// game-kit/adapter — Poki adapter STUB (not active).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ DO NOT "finish" this stub from memory. Before activating Poki, read    │
// │ the official SDK documentation (https://sdk.poki.com) and verify every  │
// │ method name and signature against the CURRENT SDK version. Method      │
// │ names in the wild have changed before (gameplayStart → gamePlayStart   │
// │ etc.) — guessing them is exactly what this stub refuses to do.         │
// └─────────────────────────────────────────────────────────────────────────┘
//
// This stub implements OUR PortalAdapter contract with safe defaults and logs
// what WOULD be forwarded, so a game can be smoke-tested against it today.
// Activation checklist (when a Poki account exists):
//   1. Read https://sdk.poki.com — SDK script URL, init, gameplay events,
//      commercialBreak / rewardedBreak APIs, loading finished signal.
//   2. Map each verified SDK call into the methods below.
//   3. Load the SDK script in init() ONLY (never in game code).
//   4. Run the QA.md portability checklist (zero external requests from the
//      game module itself; all requests originate here).

import type { AdResult, PortalAdapter } from './types'

const TAG = '[poki-stub]'

export class PokiAdapterStub implements PortalAdapter {
  async init(): Promise<void> {
    console.info(`${TAG} init() — load the Poki SDK here after verifying docs`)
  }

  loadingFinished(): void {
    console.info(`${TAG} loadingFinished() → SDK "game loading finished" signal`)
  }

  gameplayStart(): void {
    console.info(`${TAG} gameplayStart() → SDK gameplay start`)
  }

  gameplayStop(): void {
    console.info(`${TAG} gameplayStop() → SDK gameplay stop`)
  }

  async showInterstitial(opts: { naturalBreak: boolean }): Promise<AdResult> {
    console.info(`${TAG} commercialBreak (naturalBreak=${opts.naturalBreak})`)
    return { shown: false, reason: 'stub' }
  }

  async showRewarded(): Promise<AdResult> {
    console.info(`${TAG} rewardedBreak`)
    return { shown: false, reason: 'stub' }
  }

  trackEvent(name: string, data?: unknown): void {
    console.info(`${TAG} trackEvent(${String(name)})`, data ?? {})
  }
}
