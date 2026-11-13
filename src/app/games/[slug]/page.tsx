import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GAMES, getGame, relatedGames } from '@/games/registry'
import { CONTENT } from '@/games/content'
import { GENRES } from '@/games/types'
import { GameStage } from '@/components/portal/GameStage'
import { GameCard } from '@/components/portal/GameCard'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb } from '@/components/portal/JsonLd'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const dynamicParams = false

export function generateStaticParams() {
  return GAMES.map((g) => ({ slug: g.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const game = getGame(slug)
  if (!game) return {}
  return {
    // "Play STACK Free Online | BRUTAL//GAMES" — 41 chars, well under 60
    title: `Play ${game.shortName} Free Online | BRUTAL//GAMES`,
    description: game.metaDescription,
    alternates: { canonical: `/games/${game.slug}` },
    openGraph: {
      title: `${game.title} — free browser game`,
      description: game.metaDescription,
      url: absUrl(`${SITE}/games/${game.slug}`),
      images: [{ url: absUrl(`${SITE}/og/${game.slug}.png`), width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${game.title} — free browser game`,
      description: game.metaDescription,
      images: [`${SITE}/og/${game.slug}.png`],
    },
  }
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = getGame(slug)
  if (!game) notFound()
  const content = CONTENT[game.slug]
  const related = relatedGames(game.slug)

  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': ['VideoGame', 'WebApplication'],
            name: game.title,
            description: game.metaDescription,
            url: absUrl(`${SITE}/games/${game.slug}`),
            applicationCategory: 'GameApplication',
            operatingSystem: 'Any',
            genre: GENRES[game.genre].label,
            playMode: 'SinglePlayer',
            gamePlatform: 'Web Browser',
            inLanguage: 'en',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
            dateModified: game.lastUpdated,
          },
          breadcrumb([
            { name: 'Home', url: absUrl(`${SITE}/`) },
            { name: 'Games', url: absUrl(`${SITE}/games`) },
            { name: game.title, url: absUrl(`${SITE}/games/${game.slug}`) },
          ]),
        ]}
      />

      <header className="border-b border-[var(--line)] px-4 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/games"
            className="text-[10px] tracking-[0.35em] text-[var(--ink-dim)] hover:text-[var(--ink)]"
          >
            ← ALL GAMES
          </Link>
          <nav className="flex items-center gap-4 text-[10px] tracking-[0.3em] text-[var(--ink-dim)]">
            <Link href="/daily" className="hover:text-amber-400">
              DAILY
            </Link>
            <Link
              href={`/games/category/${game.genre}`}
              className="hover:text-[var(--ink)]"
            >
              {GENRES[game.genre].label.toUpperCase()}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight md:text-5xl">
          {game.title}
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-dim)]">{game.tagline}</p>

        {/* the game — loads on Play click, never before */}
        <div className="mt-6">
          <GameStage
            slug={game.slug}
            title={game.title}
            shortName={game.shortName}
            tagline={game.tagline}
            controlsDesktop={game.controlsDesktop}
            controlsMobile={game.controlsMobile}
            controlsGamepad={game.controlsGamepad}
            dailyEnabled={game.dailyEnabled}
          />
        </div>

        {/* description */}
        <section aria-label={`About ${game.title}`} className="mt-10 max-w-3xl">
          <h2 className="text-lg font-black tracking-tight">About {game.shortName}</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-dim)]">{content.description}</p>
        </section>

        {/* how to play */}
        <section aria-label="How to play" className="mt-10 max-w-3xl">
          <h2 className="text-lg font-black tracking-tight">How to play</h2>
          <div className="mt-3 grid gap-3 text-xs leading-relaxed md:grid-cols-3">
            <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-3">
              <div className="mb-1 text-[10px] font-bold tracking-[0.3em] text-[var(--ink-faint)]">
                DESKTOP
              </div>
              <p className="text-[var(--ink-dim)]">{game.controlsDesktop}</p>
            </div>
            <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-3">
              <div className="mb-1 text-[10px] font-bold tracking-[0.3em] text-[var(--ink-faint)]">
                MOBILE
              </div>
              <p className="text-[var(--ink-dim)]">{game.controlsMobile}</p>
            </div>
            <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-3">
              <div className="mb-1 text-[10px] font-bold tracking-[0.3em] text-[var(--ink-faint)]">
                GAMEPAD
              </div>
              <p className="text-[var(--ink-dim)]">{game.controlsGamepad}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-dim)]">{content.howToExtra}</p>
        </section>

        {/* tips */}
        <section aria-label="Tips" className="mt-10 max-w-3xl">
          <h2 className="text-lg font-black tracking-tight">{game.shortName} tips</h2>
          <ul className="mt-3 space-y-2">
            {content.tips.map((tip) => (
              <li key={tip} className="flex gap-2 text-xs leading-relaxed text-[var(--ink-dim)]">
                <span aria-hidden className="text-red-500">
                  ▸
                </span>
                {tip}
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ — plain text, no FAQ rich-result markup (Google retired it) */}
        <section aria-label="Frequently asked questions" className="mt-10 max-w-3xl">
          <h2 className="text-lg font-black tracking-tight">FAQ</h2>
          <div className="mt-3 divide-y divide-[var(--line)] rounded border border-[var(--line)] bg-[var(--panel)]">
            {content.faq.map((f) => (
              <details key={f.q} className="group p-4">
                <summary className="cursor-pointer list-none text-xs font-bold tracking-wide text-[var(--ink)] marker:hidden">
                  <span className="mr-2 text-red-500 group-open:rotate-90 inline-block transition-transform">
                    ▸
                  </span>
                  {f.q}
                </summary>
                <p className="mt-2 pl-5 text-xs leading-relaxed text-[var(--ink-dim)]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* related */}
        <section aria-label="Related games" className="mt-12">
          <h2 className="mb-4 text-lg font-black tracking-tight">More games like {game.shortName}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </section>

        <p className="mt-10 text-[10px] tracking-[0.25em] text-[var(--ink-faint)]">
          LAST UPDATED {game.lastUpdated}
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
