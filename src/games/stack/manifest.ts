import type { GameManifest } from '../types'

export const manifest: GameManifest = {
  slug: 'stack',
  title: 'BRUTAL//STACK',
  shortName: 'STACK',
  genre: 'skill',
  tagline: 'One-tap isometric tower stacker. Slice overhangs, chain perfects, regrow the tower.',
  metaDescription:
    'One-tap tower stacking game — drop blocks, slice the overhang, chain perfect drops to regrow your tower. Free browser game, instant retry.',
  accent: 'stack',
  controlsDesktop: 'Click or press Space to drop the block. The overhang gets sliced off — miss the tower and the run ends.',
  controlsMobile: 'Tap anywhere to drop. Instant tap-to-retry when the tower falls.',
  controlsGamepad: 'Any face, shoulder or trigger button drops the block. A or Start retries.',
  maxScorePerSecond: 5,
  minRunSeconds: 3,
  dailyEnabled: true,
  lastUpdated: '2026-11-13',
}
