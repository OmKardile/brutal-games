// BRUTAL // ARENA — pilot progression: XP, levels, achievements (localStorage)

export interface PilotData {
  xp: number
  totalKills: number
  runs: number
  timePlayed: number // seconds
  bestScore: number
  bestCombo: number
  achievements: string[] // unlocked achievement ids
}

export interface AchievementDef {
  id: string
  name: string
  desc: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', name: 'FIRST BLOOD', desc: 'Score your first kill.' },
  { id: 'wave5', name: 'DEEP RUN', desc: 'Reach wave 5.' },
  { id: 'wave10', name: 'VETERAN', desc: 'Reach wave 10.' },
  { id: 'boss', name: 'BRUTE SLAYER', desc: 'Take down a Brute.' },
  { id: 'combo25', name: 'FLOW STATE', desc: 'Chain a 25-kill combo.' },
  { id: 'od', name: 'MAXIMUM CARNAGE', desc: 'Trigger Overdrive.' },
  { id: 'elite10', name: 'ELITE HUNTER', desc: 'Kill 10 elite enemies.' },
  { id: 'survivor', name: 'IRON WILL', desc: 'Survive 5 minutes in one run.' },
  { id: 'score10k', name: 'ARENA ROYALTY', desc: 'Score 10,000 in a single run.' },
  { id: 'ranked', name: 'ON THE BOARD', desc: 'Submit a score to the global leaderboard.' },
]

/** XP required to advance FROM `level` to level+1. */
export function xpForLevel(level: number): number {
  return 200 + (level - 1) * 120
}

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1
  let rem = Math.max(0, Math.floor(xp))
  while (rem >= xpForLevel(level) && level < 999) {
    rem -= xpForLevel(level)
    level++
  }
  return { level, into: rem, need: xpForLevel(level) }
}

export function emptyPilot(): PilotData {
  return {
    xp: 0,
    totalKills: 0,
    runs: 0,
    timePlayed: 0,
    bestScore: 0,
    bestCombo: 0,
    achievements: [],
  }
}

export function loadPilot(): PilotData {
  if (typeof window === 'undefined') return emptyPilot()
  try {
    const raw = window.localStorage.getItem('brutal.pilot')
    if (!raw) return emptyPilot()
    const parsed = JSON.parse(raw) as Partial<PilotData>
    return {
      ...emptyPilot(),
      ...parsed,
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
    }
  } catch {
    return emptyPilot()
  }
}

export function savePilot(p: PilotData) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem('brutal.pilot', JSON.stringify(p))
  } catch {
    // storage unavailable — progression just won't persist
  }
}

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(s)}s`
}
