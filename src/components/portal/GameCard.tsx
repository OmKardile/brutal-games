// GameCard — server-safe card for hub / category / related lists.
// Poster art + accent identity + genre chip; the canvas game loads only on
// the game page (Play click), never from listing pages.

import Link from 'next/link'
import { GameArt } from '@/components/portal/GameArt'
import { GENRES, type GameManifest } from '@/games/types'

export function GameCard({ game, priority = false }: { game: GameManifest; priority?: boolean }) {
  return (
    <Link
      href={`/games/${game.slug}`}
      className="group relative block overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] transition-colors hover:border-[var(--ink-dim)]"
    >
      <div className="relative aspect-video w-full overflow-hidden">
        <GameArt
          slug={game.slug}
          className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
          <div className="font-[family-name:var(--font-display)] text-2xl font-black tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {game.shortName}
          </div>
          <span className="rounded-sm bg-black/60 px-2 py-0.5 text-[9px] tracking-[0.25em] text-white/70">
            {GENRES[game.genre].label.toUpperCase()}
          </span>
        </div>
        {game.dailyEnabled && (
          <span className="absolute right-2 top-2 rounded-sm border border-amber-500/50 bg-black/60 px-1.5 py-0.5 text-[8px] tracking-[0.2em] text-amber-400">
            DAILY
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--ink-dim)]">{game.tagline}</p>
        <div className="mt-2 flex items-center gap-2 text-[9px] tracking-[0.3em] text-[var(--ink-faint)]">
          <span className="text-[var(--ink)] transition-colors group-hover:text-red-400">PLAY FREE →</span>
          <span>·</span>
          <span>NO DOWNLOAD</span>
        </div>
      </div>
      {priority ? null : null /* reserved: art priority flags if art becomes raster */}
    </Link>
  )
}
