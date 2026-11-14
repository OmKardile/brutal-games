import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb, itemList } from '@/components/portal/JsonLd'
import { FESTIVALS } from '@/lib/daily/festival'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'Festival Calendar — Themed Daily Challenges | BRUTAL//GAMES',
  description:
    'Diwali, Holi, Navratri, Ganesh Chaturthi and Independence Day run special themed daily challenges in BRUTAL//STACK — festival scoring twists on the same seed for everyone. Free browser game, no download.',
  alternates: { canonical: '/daily/festivals' },
}

/**
 * /daily/festivals — seasonal SEO landing page (roadmap slice 3).
 * Server-rendered from the festival table (no client fetch): fixed-date
 * windows, themed mutator sets, unique copy per festival. The active
 * festival (if any) is highlighted by wall-clock date at render time —
 * prerendered nightly is fine for a fixed-date calendar.
 */
export default function FestivalsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...FESTIVALS].sort((a, b) => (a.start < b.start ? -1 : 1))

  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={itemList(
          sorted.map((f) => ({
            name: `${f.name} daily challenge`,
            url: absUrl(`${SITE}/daily/festivals#f-${f.id}`),
          })),
        )}
      />
      <JsonLd
        data={breadcrumb([
          { name: 'Home', url: absUrl(`${SITE}/`) },
          { name: 'Daily challenge', url: absUrl(`${SITE}/daily`) },
          { name: 'Festival calendar', url: absUrl(`${SITE}/daily/festivals`) },
        ])}
      />

      <header className="border-b border-[var(--line)] px-4 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/daily" className="text-[10px] tracking-[0.35em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← THE DAILY
          </Link>
          <Link href="/games" className="text-[10px] tracking-[0.3em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ALL GAMES
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight md:text-5xl">
          FESTIVAL CALENDAR
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-dim)]">
          The daily challenge dresses up for the season. During a festival window the
          STACK daily swaps its mutator for a themed one — festival scoring twists on
          the same seed for everyone, so the whole crowd plays the same twist on the
          same day. Play it free in your browser; no download, no account needed.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {sorted.map((f) => {
            const active = today >= f.start && today <= f.end
            return (
              <section
                key={f.id}
                id={`f-${f.id}`}
                className={`rounded-lg border p-5 ${
                  active
                    ? 'border-fuchsia-700/60 bg-fuchsia-950/20 shadow-[0_0_24px_rgba(192,38,211,0.15)]'
                    : 'border-[var(--line-strong)] bg-[var(--panel)]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-[family-name:var(--font-display)] text-xl font-black tracking-tight">
                    {f.name}
                  </h2>
                  {active && (
                    <span className="rounded-sm bg-fuchsia-500/20 px-2 py-0.5 text-[9px] font-black tracking-[0.25em] text-fuchsia-300">
                      LIVE NOW
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[11px] tracking-[0.2em] text-[var(--ink-faint)]">
                  {f.start} → {f.end} · {f.mutators.length} THEMED RULES
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ink-dim)]">{f.blurb}</p>
                <ul className="mt-3 space-y-1.5">
                  {f.mutators.map((m) => (
                    <li key={m.id} className="text-[11px] leading-relaxed text-[var(--ink-dim)]">
                      <span className="font-bold tracking-widest text-amber-400">{m.label}</span>
                      {' — '}
                      {m.rule}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/games/stack?daily=1"
                  className="mt-4 inline-flex items-center gap-1.5 rounded border border-amber-700/60 bg-amber-950/30 px-3 py-1.5 text-[10px] font-black tracking-[0.3em] text-amber-400 transition-colors hover:bg-amber-900/40"
                >
                  PLAY THE DAILY
                </Link>
              </section>
            )
          })}
        </div>

        <p className="mt-8 text-[11px] leading-relaxed text-[var(--ink-faint)]">
          Festival dates follow the Gregorian calendar for the current year. Daily
          challenges, festival mutators and leaderboards are always free; daily rank
          never pays anything. Themed challenges are our own tribute art — no real
          tournament, team or player names or logos are used.
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
