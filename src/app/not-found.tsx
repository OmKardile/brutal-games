import Link from 'next/link'
import { GAMES } from '@/games/registry'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--bg)] px-4 font-mono text-[var(--ink)]">
      <div className="font-[family-name:var(--font-display)] text-[8rem] font-black leading-none tracking-tighter text-red-500/90 md:text-[12rem]">
        404
      </div>
      <p className="mt-2 text-xs tracking-[0.4em] text-[var(--ink-dim)]">
        NOTHING SURVIVED HERE
      </p>
      <p className="mt-4 max-w-md text-center text-sm leading-relaxed text-[var(--ink-dim)]">
        The page you wanted does not exist — but five games that DO exist are one click away.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {GAMES.map((g) => (
          <Link
            key={g.slug}
            href={`/games/${g.slug}`}
            className="rounded border border-[var(--line-strong)] px-3 py-1.5 text-[10px] tracking-[0.25em] text-[var(--ink-dim)] transition-colors hover:border-red-800 hover:text-red-400"
          >
            {g.shortName}
          </Link>
        ))}
      </div>
      <Link
        href="/"
        className="mt-8 rounded border border-red-500/60 bg-red-600 px-5 py-2.5 text-[10px] font-black tracking-[0.3em] text-white hover:bg-red-500"
      >
        BACK TO THE ARCADE
      </Link>
    </div>
  )
}
