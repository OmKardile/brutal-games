import type { Metadata } from 'next'
import Link from 'next/link'
import { DailyPanel } from '@/components/portal/DailyPanel'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb } from '@/components/portal/JsonLd'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'Daily Challenge — Same Seed for Everyone, Every Day | BRUTAL//GAMES',
  description:
    'A seeded daily challenge for every game: the same arena, tower, blade, gauntlet and pit for all players each day. Best score counts, unlimited tries.',
  alternates: { canonical: '/daily' },
}

export default function DailyPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={breadcrumb([
          { name: 'Home', url: absUrl(`${SITE}/`) },
          { name: 'Daily challenge', url: absUrl(`${SITE}/daily`) },
        ])}
      />

      <header className="border-b border-[var(--line)] px-4 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-[10px] tracking-[0.35em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← BRUTAL//GAMES
          </Link>
          <Link href="/games" className="text-[10px] tracking-[0.3em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ALL GAMES
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight md:text-5xl">
          THE DAILY
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-dim)]">
          One seeded run per game, every day, for everyone. The seed shapes what the game throws
          at you — spawn orders, zone patterns, gate layouts — and it is identical for every
          player on the planet that day. Beat it as many times as you like; only your best
          score lands on the daily board. Chain days together to build a streak.
        </p>

        <DailyPanel />
      </main>

      <SiteFooter />
    </div>
  )
}
