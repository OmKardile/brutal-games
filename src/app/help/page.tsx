import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb } from '@/components/portal/JsonLd'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'Help & FAQ | BRUTAL//GAMES',
  description:
    'Player FAQ for the BRUTAL//GAMES arcade: controls, gamepad pairing, daily challenges, leaderboards, themes and the optional rewards program.',
  alternates: { canonical: '/help' },
}

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Do I need an account to play?',
    a: (
      <>
        No. Every game is fully playable without one. An account only unlocks the optional
        rewards program and syncs your daily-challenge streak.
      </>
    ),
  },
  {
    q: 'How do I connect a gamepad?',
    a: (
      <>
        Plug it in (or pair over Bluetooth) and press any button — the game links it
        automatically and shows a PAD badge. Left stick moves, right stick aims (ARENA), face
        buttons and triggers act, and rumble fires on impacts. Keyboard/mouse and gamepad can
        be mixed freely.
      </>
    ),
  },
  {
    q: 'What is the daily challenge?',
    a: (
      <>
        A seeded run that is identical for every player each day (the day rolls over at
        midnight IST). Unlimited tries, best score counts, and consecutive days build a
        streak. Offline runs use a local seed and are marked UNRANKED.
      </>
    ),
  },
  {
    q: 'How do night and day modes work?',
    a: (
      <>
        The toggle in the site nav (and in every game HUD) flips the whole arcade between a
        pitch-black night mode and a bone-white day mode — including the game canvases,
        live, mid-run. Your choice is remembered in this browser.
      </>
    ),
  },
  {
    q: 'Where does my leaderboard score go?',
    a: (
      <>
        Enter a callsign after a run and it lands on the global per-game board. In casual
        games your local best is also stored in the browser. The daily board is separate —
        one board per game per day.
      </>
    ),
  },
  {
    q: 'How do reward points work?',
    a: (
      <>
        If the rewards program is enabled on this site: sign in, confirm you are 18+, and
        just play — points come from genuine play time, streaks and run completions (never
        from ads). Each month a share of net revenue forms a pool split pro-rata by points.
        See /rewards for the full terms.
      </>
    ),
  },
  {
    q: 'The game feels slow on my phone. Anything I can do?',
    a: (
      <>
        Close heavy tabs, avoid low-power mode, and try day mode (fewer glow effects). The
        games target 60 fps on mid-range devices; add ?perf=1 to any game URL to see the
        live fps overlay.
      </>
    ),
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={breadcrumb([
          { name: 'Home', url: absUrl(`${SITE}/`) },
          { name: 'Help', url: absUrl(`${SITE}/help`) },
        ])}
      />

      <header className="border-b border-[var(--line)] px-4 py-5">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/" className="text-[10px] tracking-[0.35em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← BRUTAL//GAMES
          </Link>
          <Link href="/games" className="text-[10px] tracking-[0.3em] text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ALL GAMES
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight">
          HELP / FAQ
        </h1>
        <div className="mt-6 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--panel)]">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="cursor-pointer list-none text-xs font-bold tracking-wide text-[var(--ink)]">
                <span className="mr-2 inline-block text-red-500 transition-transform group-open:rotate-90">
                  ▸
                </span>
                {f.q}
              </summary>
              <p className="mt-2 pl-5 text-xs leading-relaxed text-[var(--ink-dim)]">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-[11px] text-[var(--ink-faint)]">
          Still stuck? <Link href="/contact" className="underline decoration-dotted underline-offset-4">Contact us</Link>
          {' '}— a human reads everything.
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
