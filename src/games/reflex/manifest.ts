import type { GameManifest } from '../types'

export const manifest: GameManifest = {
  slug: 'reflex',
  title: 'BRUTAL//REFLEX',
  shortName: 'REFLEX',
  genre: 'skill',
  tagline: 'Timing strike. Stop the sweeping blade inside the shrinking zone, chain perfects.',
  metaDescription:
    'Timing-strike reflex game — stop the sweeping blade inside the shrinking zone and chain perfect strikes up the chime ladder. Free, no download.',
  accent: 'reflex',
  controlsDesktop: 'Click or press Space to strike when the blade crosses the zone. Perfects shrink the zone but grow your streak.',
  controlsMobile: 'Tap to strike. Watch the blade, feel the rhythm.',
  controlsGamepad: 'Any button strikes. A or Start retries instantly.',
  maxScorePerSecond: 200,
  minRunSeconds: 4,
  dailyEnabled: true,
  lastUpdated: '2026-11-13',
}
