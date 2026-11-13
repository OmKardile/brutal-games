import type { Metadata } from 'next'
import Link from 'next/link'
import { GAMES, GENRE_LIST, gamesByGenre } from '@/games/registry'
import { GENRES } from '@/games/types'
import { GameCard } from '@/components/portal/GameCard'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb, itemList } from '@/components/portal/JsonLd'

export const dynamicParams = false

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'Free Browser Games — Play 5 Games Free, No Download | BRUTAL//GAMES',
  description:
    'Five free browser games in one arcade: a twin-stick shooter, a one-tap stacker, a timing strike, a one-button dodger and a merge puzzle. No download, no account.',
  alternates: { canonical: '/games' },
  openGraph: {
    title: 'All Games — BRUTAL//GAMES',
    description: 'Five free browser games. Pick your poison — no download, instant play.',
    images: [{ url: absUrl(`${SITE}/og/site.png`), width: 1200, height: 630 }],
  },
}

export default function GamesHubPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={[
          breadcrumb([
            { name: 'Home', url: absUrl(`${SITE}/`) },
            { name: 'Games', url: absUrl(`${SITE}/games`) },
          ]),
          itemList(GAMES.map((g) => ({ name: g.title, url: absUrl(`${SITE}/games/${g.slug}`) }))),
        ]}
      />

      <header className="border-b border-[var(--line)] px-4 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-[10px] tracking-[0.35em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← BRUTAL//GAMES
          </Link>
          <nav className="flex items-center gap-4 text-[10px] tracking-[0.3em] text-[var(--ink-dim)]">
            <Link href="/daily" className="hover:text-amber-400">
              DAILY
            </Link>
            <Link href="/games" className="text-[var(--ink)]">
              ALL GAMES
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight md:text-6xl">
          ALL GAMES
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-dim)]">
          Five free browser games — shooters, stackers, timing strikes, dodgers and merge
          puzzles. Every one runs instantly in this tab: no download, no install, no account.
          Keyboard, mouse, touch and gamepad all work in every game.
        </p>

        {/* every game, straight up */}
        <section aria-label="All games" className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </section>

        {/* by category */}
        {GENRE_LIST.map((genre) => (
          <section key={genre} aria-labelledby={`genre-${genre}`} className="mt-12">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 id={`genre-${genre}`} className="text-xl font-black tracking-tight">
                {GENRES[genre].label} games
              </h2>
              <Link
                href={`/games/category/${genre}`}
                className="text-[10px] tracking-[0.3em] text-[var(--ink-faint)] hover:text-[var(--ink)]"
              >
                VIEW CATEGORY →
              </Link>
            </div>
            <p className="mb-4 max-w-2xl text-xs leading-relaxed text-[var(--ink-dim)]">
              {GENRES[genre].blurb}
            </p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {gamesByGenre(genre).map((g) => (
                <GameCard key={g.slug} game={g} />
              ))}
            </div>
          </section>
        ))}

        <section className="mt-14 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-6">
          <h2 className="text-lg font-black tracking-tight">Why play here</h2>
          <div className="mt-3 grid gap-4 text-xs leading-relaxed text-[var(--ink-dim)] md:grid-cols-3">
            <div>
              <span className="font-bold text-[var(--ink)]">INSTANT PLAY.</span> Games load when
              you press play — not while you were trying to read this page. Nothing installs,
              nothing signs you up.
            </div>
            <div>
              <span className="font-bold text-[var(--ink)]">EVERY INPUT.</span> Keyboard and
              mouse, one-thumb touch, or a gamepad with analog sticks, rumble and a laser
              reticle. Plug in and press any button.
            </div>
            <div>
              <span className="font-bold text-[var(--ink)]">NIGHT &amp; DAY.</span> The whole
              arcade — site and every game canvas — flips between a pitch-black night mode and a
              bone-white day mode, live, mid-run.
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
