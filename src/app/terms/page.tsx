import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Rewards Program Terms — BRUTAL//ARENA',
}

const sections: Array<{ h: string; p: string[] }> = [
  {
    h: '1. WHAT THIS PROGRAM IS',
    p: [
      'Players earn points through genuine engagement — playing the game, daily streaks, and challenges. Each month, a configurable share (default 30%) of the game\'s NET revenue for that month forms a reward pool. That pool is divided between players in proportion to their valid points for the month.',
      'The pool is the only source of payouts. If revenue is zero, the pool is zero and no payouts are made for that month.',
    ],
  },
  {
    h: '2. ESTIMATES ARE NOT GUARANTEES',
    p: [
      'Any share amount shown before a month is finalized is an ESTIMATE and is explicitly not guaranteed. The final amount depends entirely on actual, verified revenue and the total valid points of all players.',
    ],
  },
  {
    h: '3. EARNING POINTS',
    p: [
      'Points are awarded server-side only, for: validated active play time (tab visible with real input activity, checked on a fixed heartbeat), daily login streaks, run completions, and daily challenges. Each reason is subject to a per-day cap.',
      'Points are recorded in an append-only ledger. Administrators can reverse (void) points with an audit trail.',
    ],
  },
  {
    h: '4. ANTI-FRAUD',
    p: [
      'One account per person. We check device fingerprints and IP clustering, and suspicious accounts go to manual review. Confirmed fraud — multiple accounts, bots, forged activity, or any manipulation — voids all rewards and may freeze the account.',
      'Frozen accounts cannot earn points or request payouts.',
    ],
  },
  {
    h: '5. PAYOUTS',
    p: [
      'Payouts are manual in this version: you request a payout to your UPI ID once your credited balance is at or above the minimum threshold; balances below the threshold carry over. Requests are held for a configurable review period (default 14 days) before an admin can approve, and are then marked paid with a transaction reference.',
      'You must have a verified email address and have declared that you are 18 or older to earn points or request payouts.',
      'Per-player monthly payout caps may apply; amounts above a cap remain in the pool.',
    ],
  },
  {
    h: '6. PROGRAM CHANGES AND TERMINATION',
    p: [
      'We can change the reward rates, caps, thresholds, and hold periods at any time, or stop the program entirely. Points are not property, have no cash value until converted into a credited distribution by a locked monthly pool, and earn nothing on their own.',
      'These terms were last updated with version 0.3.0 of the game.',
    ],
  },
]

export default function TermsPage() {
  return (
    <main className="min-h-dvh bg-[#070709] px-4 py-8 font-mono text-stone-200">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO SITE
        </Link>
        <h1 className="text-3xl font-black tracking-tighter text-red-500">REWARDS TERMS</h1>
        <p className="mb-8 mt-2 text-[10px] tracking-[0.3em] text-stone-500">
          PLAIN LANGUAGE · NO FINE PRINT TRICKS
        </p>

        <div className="flex flex-col gap-6">
          {sections.map((s) => (
            <section key={s.h} className="rounded border border-stone-800/80 bg-black/60 p-5">
              <h2 className="mb-3 text-[12px] font-black tracking-[0.2em] text-amber-400">{s.h}</h2>
              {s.p.map((para, i) => (
                <p key={i} className="mb-2 text-[12px] leading-relaxed tracking-wide text-stone-300 last:mb-0">
                  {para}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-8 text-center text-[9px] tracking-[0.2em] text-stone-700">
          SEE ALSO: <Link href="/privacy" className="text-stone-500 hover:text-stone-300">PRIVACY POLICY</Link>
        </p>
      </div>
    </main>
  )
}
