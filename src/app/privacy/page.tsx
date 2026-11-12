import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy — BRUTAL//ARENA',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-[#070709] px-4 py-8 font-mono text-stone-200">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO SITE
        </Link>
        <h1 className="text-3xl font-black tracking-tighter text-red-500">PRIVACY POLICY</h1>
        <p className="mb-8 mt-2 text-[10px] tracking-[0.3em] text-stone-500">
          WHAT WE STORE AND WHY — SHORT VERSION
        </p>

        <div className="flex flex-col gap-5">
          <section className="rounded border border-stone-800/80 bg-black/60 p-5">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.2em] text-amber-400">
              IF YOU PLAY WITHOUT AN ACCOUNT
            </h2>
            <p className="text-[12px] leading-relaxed tracking-wide text-stone-300">
              Your pilot progression (XP, achievements) stays in your browser's local
              storage. Leaderboard scores store only the callsign you type. Nothing
              else leaves your machine.
            </p>
          </section>

          <section className="rounded border border-stone-800/80 bg-black/60 p-5">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.2em] text-amber-400">
              IF YOU CREATE A REWARDS ACCOUNT
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-stone-800 text-left text-stone-500">
                    <th className="py-2 pr-4 font-normal tracking-widest">DATA</th>
                    <th className="py-2 pr-4 font-normal tracking-widest">WHY</th>
                  </tr>
                </thead>
                <tbody className="text-stone-300">
                  <tr className="border-b border-stone-900">
                    <td className="py-2 pr-4 align-top">Email address</td>
                    <td className="py-2 align-top">Account login, verification, password reset, payout notifications</td>
                  </tr>
                  <tr className="border-b border-stone-900">
                    <td className="py-2 pr-4 align-top">Password</td>
                    <td className="py-2 align-top">Stored only as a salted scrypt hash — never in readable form</td>
                  </tr>
                  <tr className="border-b border-stone-900">
                    <td className="py-2 pr-4 align-top">IP addresses</td>
                    <td className="py-2 align-top">Rate limiting and one-account-per-person checks; stored with your device record and fraud flags</td>
                  </tr>
                  <tr className="border-b border-stone-900">
                    <td className="py-2 pr-4 align-top">Device fingerprint</td>
                    <td className="py-2 align-top">A hash of browser/device signals (screen, language, timezone, hardware hints) used to detect duplicate accounts. The raw signals are not stored, only the combined hash</td>
                  </tr>
                  <tr className="border-b border-stone-900">
                    <td className="py-2 pr-4 align-top">Play activity</td>
                    <td className="py-2 align-top">Heartbeat counts, points earned, and run outcomes — the reward ledger</td>
                  </tr>
                  <tr className="border-b border-stone-900">
                    <td className="py-2 pr-4 align-top">UPI ID</td>
                    <td className="py-2 align-top">Paying out approved rewards to you</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 align-top">18+ declaration timestamp</td>
                    <td className="py-2 align-top">Legal requirement for money-adjacent features</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded border border-stone-800/80 bg-black/60 p-5">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.2em] text-amber-400">
              WHAT WE DON'T DO
            </h2>
            <ul className="list-inside list-disc text-[12px] leading-relaxed tracking-wide text-stone-300">
              <li>No selling or sharing of your personal data with third parties.</li>
              <li>No tracking of ad impressions or clicks tied to your account.</li>
              <li>No automated payout decisions — every payout is human-reviewed.</li>
              <li>No third-party analytics on the game pages.</li>
            </ul>
          </section>

          <section className="rounded border border-stone-800/80 bg-black/60 p-5">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.2em] text-amber-400">
              THIRD-PARTY SERVICES
            </h2>
            <p className="text-[12px] leading-relaxed tracking-wide text-stone-300">
              Sign-up and payout forms use Cloudflare Turnstile for bot protection.
              If Google login is enabled, Google processes that sign-in under its own
              policy. Email delivery runs through a transactional email provider
              (Resend or Brevo).
            </p>
          </section>
        </div>

        <p className="mt-8 text-center text-[9px] tracking-[0.2em] text-stone-700">
          SEE ALSO: <Link href="/terms" className="text-stone-500 hover:text-stone-300">REWARDS TERMS</Link>
        </p>
      </div>
    </main>
  )
}
