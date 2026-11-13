// Site footer for portal pages (hub, categories, daily, about, contact, help).
// The landing page keeps its own mega footer with the same credit line.
//
// Branding rule (see decisions.md): the author credit lives in the site
// chrome and standalone pages ONLY — never inside game code or game builds
// (portals ban outgoing links/branding in submissions).

import Link from 'next/link'
import { GAMES } from '@/games/registry'
import { GENRE_LIST } from '@/games/registry'
import { GENRES } from '@/games/types'

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] px-4 py-10">
      <div className="mx-auto grid max-w-6xl gap-8 text-xs md:grid-cols-4">
        <div>
          <div className="font-[family-name:var(--font-display)] text-lg font-black tracking-tight text-[var(--ink)]">
            BRUTAL//GAMES
          </div>
          <p className="mt-2 leading-relaxed text-[var(--ink-dim)]">
            Five free browser games. No download, no install — pick one and play.
          </p>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-bold tracking-[0.3em] text-[var(--ink-faint)]">GAMES</div>
          <ul className="space-y-1.5">
            {GAMES.map((g) => (
              <li key={g.slug}>
                <Link href={`/games/${g.slug}`} className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                  {g.shortName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-bold tracking-[0.3em] text-[var(--ink-faint)]">CATEGORIES</div>
          <ul className="space-y-1.5">
            {GENRE_LIST.map((g) => (
              <li key={g}>
                <Link
                  href={`/games/category/${g}`}
                  className="text-[var(--ink-dim)] hover:text-[var(--ink)]"
                >
                  {GENRES[g].label} games
                </Link>
              </li>
            ))}
            <li>
              <Link href="/daily" className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                Daily challenge
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-bold tracking-[0.3em] text-[var(--ink-faint)]">SITE</div>
          <ul className="space-y-1.5">
            <li>
              <Link href="/about" className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                About
              </Link>
            </li>
            <li>
              <Link href="/help" className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                Help / FAQ
              </Link>
            </li>
            <li>
              <Link href="/contact" className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                Contact
              </Link>
            </li>
            <li>
              <Link href="/terms" className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="text-[var(--ink-dim)] hover:text-[var(--ink)]">
                Privacy
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-6xl border-t border-[var(--line)] pt-4 text-[11px] text-[var(--ink-faint)]">
        © {new Date().getFullYear()} BRUTAL//GAMES — a fan tribute, not affiliated with ahwoo.{' '}
        <a
          href="https://omkardile.is-a.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-4 hover:text-[var(--ink-dim)]"
        >
          Designed &amp; developed by Omkar Kardile
        </a>
      </div>
    </footer>
  )
}
