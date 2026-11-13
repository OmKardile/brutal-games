import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb } from '@/components/portal/JsonLd'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'About | BRUTAL//GAMES',
  description:
    'BRUTAL//GAMES is a free five-game browser arcade — a fan tribute to the open-source BRUTAL game framework. Built by Omkar Kardile.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={[
          breadcrumb([
            { name: 'Home', url: absUrl(`${SITE}/`) },
            { name: 'About', url: absUrl(`${SITE}/about`) },
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'BRUTAL//GAMES',
            url: absUrl(`${SITE}/`),
            founder: { '@type': 'Person', name: 'Omkar Kardile', url: 'https://omkardile.is-a.dev/' },
          },
        ]}
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

      <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-relaxed text-[var(--ink-dim)]">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight text-[var(--ink)]">
          ABOUT
        </h1>

        <p className="mt-6">
          BRUTAL//GAMES is a free browser arcade with five games: a twin-stick wave shooter
          (ARENA), a one-tap tower stacker (STACK), a timing strike (REFLEX), a one-button
          gauntlet (DODGE) and a drop-fuse puzzle (MERGE). Everything runs instantly in the
          tab — no downloads, no installs, no accounts required to play.
        </p>
        <p className="mt-4">
          The arcade is a fan-made tribute to{' '}
          <a
            href="https://github.com/ahwootech/BRUTAL"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-4 hover:text-[var(--ink)]"
          >
            BRUTAL
          </a>
          , the open-source C# game framework by ahwoo. It is not affiliated with the original
          project — we just liked the name and the attitude.
        </p>
        <p className="mt-4">
          Under the hood it is a Next.js app with dependency-free canvas game engines, WebAudio
          synth sound (no audio files), night and day themes that re-skin every game canvas
          live, full gamepad support with rumble, and a server-authoritative daily challenge
          system. Games load only when you press play, on purpose.
        </p>

        <div className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="text-xs font-black tracking-[0.3em] text-[var(--ink)]">CREDITS</div>
          <p className="mt-2">
            Designed &amp; developed by{' '}
            <a
              href="https://omkardile.is-a.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[var(--ink)] underline decoration-dotted underline-offset-4"
            >
              Omkar Kardile
            </a>
            .
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/games"
            className="rounded border border-red-500/60 bg-red-600 px-4 py-2.5 text-[10px] font-black tracking-[0.25em] text-white hover:bg-red-500"
          >
            PLAY THE GAMES
          </Link>
          <Link
            href="/contact"
            className="rounded border border-[var(--line-strong)] px-4 py-2.5 text-[10px] tracking-[0.25em] text-[var(--ink-dim)] hover:text-[var(--ink)]"
          >
            CONTACT
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
