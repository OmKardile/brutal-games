import type { GameManifest } from '../types'

export const manifest: GameManifest = {
  slug: 'merge',
  title: 'BRUTAL//MERGE',
  shortName: 'MERGE',
  genre: 'puzzle',
  tagline: 'Drop-fuse pit. Fuse circles up an 11-tier chain and detonate the SINGULARITY.',
  metaDescription:
    'Drop-merge puzzle game — fuse falling circles up an 11-tier chain, ride the combo window and detonate the singularity. Free browser game.',
  accent: 'merge',
  controlsDesktop: 'Aim with the mouse or arrow keys, click or press Space to drop. Two circles of a tier fuse into the next.',
  controlsMobile: 'Drag to aim, release to drop. Keep the pile under the danger line.',
  controlsGamepad: 'Left stick or d-pad aims, A or RT drops.',
  maxScorePerSecond: 1500,
  minRunSeconds: 8,
  dailyEnabled: true,
  lastUpdated: '2026-11-13',
}
