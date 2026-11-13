// BRUTAL — shared NIGHT / DAY palettes for every game engine.
//
// The site chrome uses CSS variables (see globals.css); the canvas engines use
// these plain objects so a theme flip re-renders the live game on the next
// frame. Neutrals flip hard (black pit -> bone paper); each game keeps its own
// accent identity in both modes, only shifting a shade darker on light
// backgrounds for contrast.

export type GameThemeMode = 'night' | 'day'

export interface GameNeutrals {
  /** deep background */
  bg: string
  /** raised surface (panels, tracks, floors) */
  raise: string
  /** grid / hairline color */
  grid: string
  /** primary ink (text, outlines) */
  ink: string
  /** secondary ink */
  inkDim: string
  /** faint ink */
  inkFaint: string
  /** the "bright pop" color — white text in night, ink-black in day */
  pop: string
  danger: string
  good: string
  /** transparent scrims */
  veil: string
}

export const NEUTRALS: Record<GameThemeMode, GameNeutrals> = {
  night: {
    bg: '#08080c',
    raise: '#12121a',
    grid: 'rgba(255,255,255,0.055)',
    ink: '#f5f5f4',
    inkDim: '#a8a29e',
    inkFaint: '#5c5753',
    pop: '#ffffff',
    danger: '#ff4d4d',
    good: '#6dff8a',
    veil: 'rgba(5,5,9,0.72)',
  },
  day: {
    bg: '#efece3',
    raise: '#fdfcf8',
    grid: 'rgba(27,25,23,0.1)',
    ink: '#1b1917',
    inkDim: '#57534e',
    inkFaint: '#a8a29e',
    pop: '#141210',
    danger: '#dc2626',
    good: '#15803d',
    veil: 'rgba(239,236,227,0.8)',
  },
}

export interface AccentSet {
  main: string
  dim: string
  hot: string
}

export type AccentKey = 'arena' | 'stack' | 'reflex' | 'dodge' | 'merge'

/** per-game accent triplets, tuned per mode for contrast */
export const ACCENTS: Record<AccentKey, Record<GameThemeMode, AccentSet>> = {
  arena: {
    night: { main: '#ef4444', dim: '#7f1d1d', hot: '#ff6b6b' },
    day: { main: '#dc2626', dim: '#991b1b', hot: '#ef4444' },
  },
  stack: {
    night: { main: '#f59e0b', dim: '#92400e', hot: '#fbbf24' },
    day: { main: '#b45309', dim: '#78350f', hot: '#d97706' },
  },
  reflex: {
    night: { main: '#22d3ee', dim: '#155e75', hot: '#a5f3fc' },
    day: { main: '#0891b2', dim: '#155e75', hot: '#06b6d4' },
  },
  dodge: {
    night: { main: '#c084fc', dim: '#6b21a8', hot: '#e9d5ff' },
    day: { main: '#7c3aed', dim: '#581c87', hot: '#a855f7' },
  },
  merge: {
    night: { main: '#a3e635', dim: '#3f6212', hot: '#d9f99d' },
    day: { main: '#4d7c0f', dim: '#365314', hot: '#65a30d' },
  },
}

/** convenience: full palette for a game */
export interface GamePalette extends GameNeutrals {
  accent: AccentSet
  theme: GameThemeMode
}

export function paletteFor(game: AccentKey, mode: GameThemeMode): GamePalette {
  return { ...NEUTRALS[mode], accent: ACCENTS[game][mode], theme: mode }
}
