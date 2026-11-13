import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/portal/SiteFooter'
import { JsonLd, breadcrumb } from '@/components/portal/JsonLd'

import { absUrl } from '@/lib/site'

const SITE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'Contact | BRUTAL//GAMES',
  description:
    'Get in touch with the BRUTAL//GAMES arcade — bug reports, feedback, takedown requests and partnership questions.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] font-mono text-[var(--ink)]">
      <JsonLd
        data={breadcrumb([
          { name: 'Home', url: absUrl(`${SITE}/`) },
          { name: 'Contact', url: absUrl(`${SITE}/contact`) },
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

      <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-relaxed text-[var(--ink-dim)]">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-black tracking-tight text-[var(--ink)]">
          CONTACT
        </h1>

        <div className="mt-6 space-y-6">
          <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-xs font-black tracking-[0.3em] text-[var(--ink)]">BUGS &amp; FEEDBACK</h2>
            <p className="mt-2">
              Something broken, unfair or ugly? Tell us what game, what browser and what
              happened — screenshots help. Email{' '}
              <a href="mailto:feedback@brutal.games" className="text-[var(--ink)] underline decoration-dotted underline-offset-4">
                feedback@brutal.games
              </a>{' '}
              or open an issue on the{' '}
              <a
                href="https://github.com/OmKardile/brutal-games/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--ink)] underline decoration-dotted underline-offset-4"
              >
                GitHub repo
              </a>
              .
            </p>
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-xs font-black tracking-[0.3em] text-[var(--ink)]">REWARDS PROGRAM</h2>
            <p className="mt-2">
              Questions about points, payouts or your account? Email{' '}
              <a href="mailto:rewards@brutal.games" className="text-[var(--ink)] underline decoration-dotted underline-offset-4">
                rewards@brutal.games
              </a>
              . Payout issues are reviewed by a human, usually within the hold period.
            </p>
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-xs font-black tracking-[0.3em] text-[var(--ink)]">LEGAL / TAKEDOWNS</h2>
            <p className="mt-2">
              This arcade is a fan tribute and uses no assets from the original BRUTAL project.
              For legal queries or takedown requests, email{' '}
              <a href="mailto:legal@brutal.games" className="text-[var(--ink)] underline decoration-dotted underline-offset-4">
                legal@brutal.games
              </a>{' '}
              — we respond and we do not lawyer-tag.
            </p>
          </section>
        </div>

        <p className="mt-8 text-[11px] text-[var(--ink-faint)]">
          BRUTAL//GAMES is designed &amp; developed by{' '}
          <a
            href="https://omkardile.is-a.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-4"
          >
            Omkar Kardile
          </a>
          .
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
