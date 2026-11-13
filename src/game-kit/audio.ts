// game-kit — audio host around the existing WebAudio synth (`src/game/audio.ts`).
//
// House rules enforced here, not per-game:
//  - unlock on FIRST user gesture (browsers block audio until a gesture)
//  - one global mute, persisted across sessions via safe storage
//  - auto-mute while the tab is hidden (respects the user's visible pref)
//  - `suppress()` for ad breaks / portal rules: temporarily silences without
//    clobbering the saved preference, and un-suppressing restores it.
//
// The existing engines keep their own internal Sfx instances — untouched. This
// host is for kit-native games and portal UI sounds; both volume states are
// independent and both are driven by the same saved preference key when the
// host is the only audio source on the page.

import { Sfx } from '../game/audio'
import { safeLocal, type SafeStorage } from './storage'

const MUTE_KEY = 'brutal.audio.muted'

export class AudioHost {
  readonly sfx = new Sfx()
  private storage: SafeStorage | null = null
  private unlocked = false
  private destroyed = false
  /** user preference */
  private userMuted = false
  /** transient silence (ad break, tab hidden) */
  private suppressed = 0

  constructor() {
    if (typeof window === 'undefined') return
    this.storage = safeLocal()
    this.userMuted = this.storage.get(MUTE_KEY) === '1'
    this.applyMute()
    window.addEventListener('pointerdown', this.unlock, { passive: true })
    window.addEventListener('keydown', this.unlock)
    window.addEventListener('touchstart', this.unlock, { passive: true })
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  /** unlock audio on the first gesture (idempotent) */
  unlock = (): void => {
    if (this.unlocked || this.destroyed) return
    this.unlocked = true
    this.sfx.unlock()
  }

  get muted(): boolean {
    return this.userMuted
  }

  /** set the user's mute preference (persisted) */
  setMuted(m: boolean): void {
    this.userMuted = m
    this.storage?.set(MUTE_KEY, m ? '1' : '0')
    this.applyMute()
  }

  toggleMute(): boolean {
    this.setMuted(!this.userMuted)
    return this.userMuted
  }

  /** temporarily silence (ad playing / tab hidden). Call release() after. */
  suppress(): void {
    this.suppressed++
    this.applyMute()
  }

  release(): void {
    if (this.suppressed > 0) this.suppressed--
    this.applyMute()
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.suppress()
    else this.release()
  }

  private applyMute(): void {
    this.sfx.muted = this.userMuted || this.suppressed > 0
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('pointerdown', this.unlock)
    window.removeEventListener('keydown', this.unlock)
    window.removeEventListener('touchstart', this.unlock)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }
}
