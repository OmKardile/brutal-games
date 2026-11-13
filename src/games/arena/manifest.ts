import type { GameManifest } from '../types'

export const manifest: GameManifest = {
  slug: 'arena',
  title: 'BRUTAL//ARENA',
  shortName: 'ARENA',
  genre: 'action',
  tagline: 'Top-down twin-stick wave shooter. Draft upgrades, chain kills, survive the boss.',
  metaDescription:
    'Free twin-stick wave shooter in your browser — escalating waves, upgrade drafts, overdrive and bosses. Keyboard, touch and gamepad. No download.',
  accent: 'arena',
  controlsDesktop: 'WASD or arrows to move, mouse to aim, hold left button to fire. Shift dashes, E triggers Overdrive, P pauses, 1-3 picks upgrades.',
  controlsMobile: 'Left virtual stick moves, right stick aims and auto-fires. Tap the dash and overdrive buttons.',
  controlsGamepad: 'Left stick moves, right stick aims (laser reticle), RT/R2 fires, B/LB dashes, Y/R3 fires Overdrive, Start pauses.',
  maxScorePerSecond: 400,
  minRunSeconds: 10,
  dailyEnabled: true,
  lastUpdated: '2026-11-13',
}
