'use client'

// Small game-over hint shown when a score could not be posted to the global
// ranked board (guest) or was stored display-only (no valid run token).

import Link from 'next/link'

export function RankAuthHint() {
  return (
    <p className="mt-2 text-center text-[10px] tracking-widest text-[var(--ink-dim)]">
      <Link
        href="/login"
        className="text-amber-500 underline-offset-4 transition-colors hover:text-amber-400 hover:underline"
      >
        SIGN IN
      </Link>{' '}
      TO RANK ON THE GLOBAL BOARD
    </p>
  )
}
