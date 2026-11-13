'use client'

// NIGHT / DAY flip switch — used in the site nav and every game menu.
// Reads the global theme; one click flips the whole site AND the live game
// canvas (engines re-render with their day palette on the next frame).

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const night = theme === 'night'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={night ? 'Switch to day mode' : 'Switch to night mode'}
      title={night ? 'DAY MODE — bone & ink' : 'NIGHT MODE — pitch black'}
      className={cn(
        'group relative flex h-9 w-16 items-center rounded-full border border-[var(--line-strong)] bg-[var(--bg-raise)] px-1 transition-colors hover:border-[var(--accent)]',
        className,
      )}
    >
      <span
        className={cn(
          'absolute flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300',
          night
            ? 'translate-x-0 bg-[#18181f] text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
            : 'translate-x-8 bg-amber-400 text-[#1b1917] shadow-[0_0_12px_rgba(245,158,11,0.5)]',
        )}
      >
        {night ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </span>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-between px-2.5 text-[8px] font-black tracking-widest text-[var(--ink-faint)]">
        <span className={night ? 'opacity-0' : 'opacity-100'}>N</span>
        <span className={night ? 'opacity-100' : 'opacity-0'}>D</span>
      </span>
    </button>
  )
}
