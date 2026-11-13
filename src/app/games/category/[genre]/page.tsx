import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { gamesByGenre, GENRE_LIST } from '@/games/registry'
import { GENRES, type GameGenre } from '@/games/types'
import { GameCard } from '@/components/portal/GameCard'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb, itemList } from '@/components/portal/JsonLd'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const dynamicParams = false

export function generateStaticParams() {
  return GENRE_LIST.map((genre) => ({ genre }))
}

const CATEGORY_INTRO: Record<GameGenre, string> = {
  action:
    'Action games here are about survival under pressure — a twin-stick arena that escalates every wave and a one-button gauntlet where the only safe line is the one you barely fit through. Reflexes first, questions later.',
  skill:
    'Skill games strip the controls down to one input and make it count: a single tap drops a tower block, a single strike stops a blade. Ten seconds to learn, a lifetime to stop flinching at the perfect moment.',
  puzzle:
    'Puzzle games reward the brain over the hands. Position drops, chain fuses, keep the pile under the line — every move is a small decision that compounds into either a cascade or a collapse.',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ genre: string }>
}): Promise<Metadata> {
  const { genre } = await params
  if (!GENRE_LIST.includes(genre as GameGenre)) return {}
  const g = genre as GameGenre
  const games = gamesByGenre(g)
  const title = `Free ${GENRES[g].label} Games — Play Online, No Download | BRUTAL//GAMES`
  return {
    title: title.length <= 60 ? title : `${GENRES[g].label} Games | BRUTAL//GAMES`,
    description: `Play ${games.length} free ${GENRES[g].label.toLowerCase()} browser games — ${games
      .map((x) => x.shortName)
      .join(', ')}. No download, instant play, keyboard/touch/gamepad.`,
    alternates: { canonical: `/games/category/${genre}` },
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ genre: string }> }) {
  const { genre } = await params
  if (!GENRE_LIST.includes(genre as GameGenre)) notFound()
  const g = genre as GameGenre
  const games = gamesByGenre(g)

  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={[
          breadcrumb([
            { name: 'Home', url: absUrl(`${SITE}/`) },
            { name: 'Games', url: absUrl(`${SITE}/games`) },
            { name: `${GENRES[g].label} games`, url: absUrl(`${SITE}/games/category/${g}`) },
          ]),
          itemList(games.map((x) => ({ name: x.title, url: absUrl(`${SITE}/games/${x.slug}`) }))),
        ]}
      />

      <header className="border-b border-[var(--line)] px-4 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/games" className="text-[10px] tracking-[0.35em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← ALL GAMES
          </Link>
          <nav className="flex items-center gap-4 text-[10px] tracking-[0.3em] text-[var(--ink-dim)]">
            {GENRE_LIST.map((x) => (
              <Link
                key={x}
                href={`/games/category/${x}`}
                className={x === g ? 'text-[var(--ink)]' : 'hover:text-[var(--ink)]'}
              >
                {GENRES[x].label.toUpperCase()}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight md:text-5xl">
          {GENRES[g].label.toUpperCase()} GAMES
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-dim)]">
          {CATEGORY_INTRO[g]}
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--ink-faint)]">{GENRES[g].blurb}</p>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((x) => (
            <GameCard key={x.slug} game={x} />
          ))}
        </div>

        <section className="mt-12 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-sm font-black tracking-tight">Other categories</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {GENRE_LIST.filter((x) => x !== g).map((x) => (
              <Link
                key={x}
                href={`/games/category/${x}`}
                className="rounded border border-[var(--line-strong)] px-3 py-1.5 text-[10px] tracking-[0.3em] text-[var(--ink-dim)] hover:text-[var(--ink)]"
              >
                {GENRES[x].label.toUpperCase()} →
              </Link>
            ))}
            <Link
              href="/games"
              className="rounded border border-[var(--line-strong)] px-3 py-1.5 text-[10px] tracking-[0.3em] text-[var(--ink-dim)] hover:text-[var(--ink)]"
            >
              ALL GAMES →
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
