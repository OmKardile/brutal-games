import type { GameManifest } from '../types'

export const manifest: GameManifest = {
  slug: 'dodge',
  title: 'BRUTAL//DODGE',
  shortName: 'DODGE',
  genre: 'action',
  tagline: 'One-button gauntlet. Hold to climb, release to fall, graze everything for bonuses.',
  metaDescription:
    'One-button dodge game — hold to climb, release to fall, thread the gates and graze blocks for CLOSE bonuses. Free browser game, instant retry.',
  accent: 'dodge',
  controlsDesktop: 'Hold Space (or the mouse button) to climb, release to fall. Gravity is asymmetric — plan two gates ahead.',
  controlsMobile: 'Touch and hold to climb, let go to fall. One thumb is all it takes.',
  controlsGamepad: 'Hold any face button or trigger to climb, release to fall.',
  maxScorePerSecond: 30,
  minRunSeconds: 4,
  dailyEnabled: true,
  lastUpdated: '2026-11-13',
}
