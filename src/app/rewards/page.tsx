'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Turnstile } from '@/components/Turnstile'
import { useSession } from '@/hooks/use-session'
import { fmtMinor, fmtDate } from '@/lib/rewards/format'
import {
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  Coins,
  IndianRupee,
  ListChecks,
  ShieldAlert,
  Wallet,
} from 'lucide-react'

interface Summary {
  enabled: boolean
  lifetimePoints: number
  monthPoints: number
  monthKey: string
  today: { earned: number; cap: number; date: string }
  balance: { creditedMinor: number; reservedMinor: number; availableMinor: number }
  estimateMinor: number | null
  estimateBasis: string
  minPayoutMinor: number
  holdPeriodDays: number
}

interface LedgerEvent {
  id: string
  points: number
  reason: string
  note: string | null
  reversalOfId: string | null
  createdAt: string
}

interface Payout {
  id: string
  amountMinor: number
  upiId: string
  status: string
  holdUntil: string | null
  requestedAt: string
  rejectedReason: string | null
  transactionRef: string | null
}

const REASON_LABEL: Record<string, string> = {
  PLAY_TIME: 'ACTIVE PLAY',
  LOGIN_STREAK: 'LOGIN STREAK',
  RUN_COMPLETION: 'RUN COMPLETE',
  DAILY_CHALLENGE: 'DAILY CHALLENGE',
  ADMIN_VOID: 'VOIDED (ADMIN)',
}

export default function RewardsPage() {
  const { me, loading, refresh } = useSession()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [challenge, setChallenge] = useState<{ desc: string; kind: string } | null>(null)
  const [ledger, setLedger] = useState<LedgerEvent[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [siteKey, setSiteKey] = useState('')

  // consent
  const [adult, setAdult] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [consentBusy, setConsentBusy] = useState(false)

  // upi
  const [upi, setUpi] = useState('')
  const [upiBusy, setUpiBusy] = useState(false)
  const [upiMsg, setUpiMsg] = useState<string | null>(null)

  // payout
  const [amount, setAmount] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>(undefined)
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [sRes, eRes, pRes, cRes] = await Promise.all([
        fetch('/api/rewards/summary', { cache: 'no-store' }),
        fetch('/api/rewards/events?take=25', { cache: 'no-store' }),
        fetch('/api/rewards/payout', { cache: 'no-store' }),
        fetch('/api/rewards/config', { cache: 'no-store' }),
      ])
      if (sRes.ok) setSummary((await sRes.json()) as Summary)
      if (eRes.ok) setLedger(((await eRes.json()) as { events: LedgerEvent[] }).events)
      if (pRes.ok) setPayouts(((await pRes.json()) as { requests: Payout[] }).requests)
      if (cRes.ok) {
        const cfg = (await cRes.json()) as {
          challenge: { desc: string; kind: string } | null
          turnstileSiteKey: string
        }
        setChallenge(cfg.challenge)
        setSiteKey(cfg.turnstileSiteKey ?? '')
      }
    } catch {
      // stale data is fine
    }
  }, [])

  useEffect(() => {
    if (me?.user) void loadData()
  }, [me, loadData])

  // prefill UPI field with the saved value once
  useEffect(() => {
    if (me?.user?.upiId) setUpi((cur) => cur || me.user!.upiId!)
  }, [me])

  const submitConsent = async () => {
    if (consentBusy || !adult || !acceptTerms) return
    setConsentBusy(true)
    try {
      const res = await fetch('/api/rewards/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adult: true, accept: true }),
      })
      if (res.ok) await refresh()
    } finally {
      setConsentBusy(false)
    }
  }

  const saveUpi = async () => {
    if (upiBusy) return
    setUpiBusy(true)
    setUpiMsg(null)
    try {
      const res = await fetch('/api/rewards/upi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upiId: upi.trim() }),
      })
      const data = (await res.json()) as { error?: string }
      setUpiMsg(res.ok ? 'UPI ID SAVED.' : (data.error ?? 'Failed.'))
      if (res.ok) await refresh()
    } catch {
      setUpiMsg('Network error.')
    } finally {
      setUpiBusy(false)
    }
  }

  const requestPayout = async () => {
    if (payoutBusy) return
    const rupees = Number(amount)
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setPayoutMsg('Enter a valid amount in rupees.')
      return
    }
    setPayoutBusy(true)
    setPayoutMsg(null)
    try {
      const res = await fetch('/api/rewards/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountMinor: Math.round(rupees * 100), turnstileToken }),
      })
      const data = (await res.json()) as { error?: string; holdUntil?: string }
      if (!res.ok) {
        setPayoutMsg(data.error ?? 'Request failed.')
        return
      }
      setPayoutMsg(`REQUESTED — eligible for review after ${fmtDate(data.holdUntil ?? '')} (hold period).`)
      setAmount('')
      setTurnstileToken(undefined)
      await loadData()
    } catch {
      setPayoutMsg('Network error.')
    } finally {
      setPayoutBusy(false)
    }
  }

  // ---------------------------------------------------------------- render
  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#070709] font-mono text-stone-600">
        <p className="text-[11px] tracking-[0.4em]">LOADING…</p>
      </main>
    )
  }

  if (!me?.user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#070709] px-4 font-mono text-stone-200">
        <div className="w-full max-w-sm rounded border border-stone-800/80 bg-black/60 p-6 text-center">
          <Coins className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h1 className="text-xl font-black tracking-tight text-amber-400">REWARDS PROGRAM</h1>
          <p className="mb-5 mt-2 text-[11px] leading-relaxed tracking-widest text-stone-500">
            EARN POINTS BY PLAYING. A SHARE OF THE GAME'S MONTHLY REVENUE IS SPLIT
            BETWEEN PLAYERS.
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/login">
              <Button className="w-full border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500">
                LOGIN
              </Button>
            </Link>
            <Link href="/signup">
              <Button
                variant="outline"
                className="w-full border-amber-800 bg-transparent font-bold tracking-widest text-amber-500 hover:border-amber-600"
              >
                CREATE ACCOUNT
              </Button>
            </Link>
            <Link href="/play" className="mt-2 text-[10px] tracking-widest text-stone-600 hover:text-stone-400">
              JUST LET ME PLAY
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const user = me.user
  const paused = me.rewardsEnabled === false

  return (
    <main className="min-h-dvh bg-[#070709] px-4 py-8 font-mono text-stone-200">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO SITE
        </Link>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-amber-400">
              REWARDS<span className="text-red-500">//</span>PILOT
            </h1>
            <p className="mt-1 text-[10px] tracking-[0.3em] text-stone-500">
              {user.email}
              {!user.emailVerified && <span className="ml-2 text-red-500">EMAIL UNVERIFIED</span>}
            </p>
          </div>
          <Link href="/terms">
            <Badge variant="outline" className="border-stone-700 text-[9px] tracking-[0.2em] text-stone-500 hover:border-stone-500">
              PROGRAM TERMS
            </Badge>
          </Link>
        </div>

        {paused && (
          <div className="mb-6 rounded border border-stone-800/80 bg-black/60 p-5 text-center">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-stone-500" />
            <p className="text-[12px] tracking-widest text-stone-400">
              THE REWARDS PROGRAM IS CURRENTLY PAUSED. YOUR POINTS ARE SAFE.
            </p>
            <p className="mt-2 text-[10px] tracking-widest text-stone-600">
              NO NEW POINTS ARE EARNED WHILE PAUSED.
            </p>
          </div>
        )}

        {/* ------------------------------------------------ 18+ gate */}
        {!user.adultDeclared && !paused && (
          <div className="mb-6 rounded border border-amber-900/50 bg-black/60 p-5">
            <h2 className="text-sm font-black tracking-widest text-amber-400">
              ONE-TIME DECLARATION REQUIRED
            </h2>
            <p className="mt-2 text-[11px] leading-relaxed tracking-wide text-stone-400">
              The rewards program involves real money payouts and is restricted to
              adults. Confirm below to start earning points.
            </p>
            <div className="mt-4 flex flex-col gap-2 text-[11px] tracking-wide text-stone-300">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={adult}
                  onChange={(e) => setAdult(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-500"
                />
                I confirm that I am 18 years old or older.
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-500"
                />
                <span>
                  I accept the{' '}
                  <Link href="/terms" className="text-amber-500 underline-offset-2 hover:underline">
                    rewards program terms
                  </Link>
                  : payouts depend on actual revenue and can be zero; fraud voids
                  rewards; the program can change or stop.
                </span>
              </label>
            </div>
            <Button
              onClick={() => void submitConsent()}
              disabled={!adult || !acceptTerms || consentBusy}
              className="mt-4 h-10 border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500 disabled:opacity-40"
            >
              {consentBusy ? 'SAVING…' : 'CONFIRM AND START EARNING'}
            </Button>
          </div>
        )}

        {user.adultDeclared && !paused && summary && (
          <>
            {/* ------------------------------------------------ stats */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="flex items-center gap-1.5 text-[9px] tracking-widest text-stone-500">
                  <Coins className="h-3 w-3" /> LIFETIME POINTS
                </div>
                <div className="mt-1 text-2xl font-black text-amber-400">
                  {summary.lifetimePoints.toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="flex items-center gap-1.5 text-[9px] tracking-widest text-stone-500">
                  <CalendarCheck className="h-3 w-3" /> THIS MONTH ({summary.monthKey})
                </div>
                <div className="mt-1 text-2xl font-black text-stone-100">
                  {summary.monthPoints.toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="flex items-center gap-1.5 text-[9px] tracking-widest text-stone-500">
                  <IndianRupee className="h-3 w-3" /> AVAILABLE BALANCE
                </div>
                <div className="mt-1 text-2xl font-black text-emerald-400">
                  {fmtMinor(summary.balance.availableMinor)}
                </div>
              </div>
              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="flex items-center gap-1.5 text-[9px] tracking-widest text-stone-500">
                  <ListChecks className="h-3 w-3" /> TODAY
                </div>
                <div className="mt-1 text-2xl font-black text-stone-100">
                  {summary.today.earned}
                  <span className="text-sm text-stone-500">/{summary.today.cap}</span>
                </div>
              </div>
            </div>

            {/* ------------------------------------------------ estimate */}
            <div className="mt-3 rounded border border-amber-900/40 bg-black/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.25em] text-amber-500">
                  ESTIMATED SHARE — ESTIMATE, NOT GUARANTEED
                </span>
                <Badge variant="outline" className="border-amber-900/60 text-[8px] tracking-[0.2em] text-amber-700">
                  SHARE OF MONTHLY REVENUE
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed tracking-wide text-stone-400">
                {summary.estimateMinor !== null ? (
                  <>
                    Based on the revenue figure entered so far for {summary.monthKey},
                    your estimated share is{' '}
                    <span className="font-black text-amber-400">{fmtMinor(summary.estimateMinor)}</span>.{' '}
                  </>
                ) : (
                  <>
                    Your share for {summary.monthKey} is calculated after the month
                    closes and the actual revenue is confirmed.{' '}
                  </>
                )}
                The final amount depends entirely on actual revenue and can be zero.
              </p>
              {challenge && (
                <p className="mt-3 border-t border-amber-950/60 pt-3 text-[11px] tracking-widest text-stone-400">
                  DAILY CHALLENGE: <span className="text-amber-400">{challenge.desc}</span> — +
                  BONUS POINTS ON COMPLETION
                </p>
              )}
            </div>

            {/* ------------------------------------------------ payout */}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="flex items-center gap-1.5 text-[10px] tracking-widest text-stone-500">
                  <Wallet className="h-3.5 w-3.5" /> UPI ID
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    value={upi}
                    onChange={(e) => setUpi(e.target.value)}
                    placeholder="yourname@bank"
                    className="h-10 border-stone-700 bg-black/60 tracking-wide placeholder:text-stone-700 focus-visible:ring-amber-500"
                    aria-label="UPI ID"
                  />
                  <Button
                    onClick={() => void saveUpi()}
                    disabled={upiBusy || upi.trim().length === 0}
                    variant="outline"
                    className="h-10 border-amber-800 bg-transparent font-bold tracking-widest text-amber-500 hover:border-amber-600"
                  >
                    {upiBusy ? '…' : 'SAVE'}
                  </Button>
                </div>
                {upiMsg && <p className="mt-2 text-[10px] tracking-widest text-stone-400">{upiMsg}</p>}
                <p className="mt-2 text-[9px] leading-relaxed tracking-widest text-stone-600">
                  DOUBLE-CHECK IT — PAYOUTS GO TO WHATEVER UPI ID IS SAVED HERE.
                </p>
              </div>

              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="flex items-center gap-1.5 text-[10px] tracking-widest text-stone-500">
                  <BadgeCheck className="h-3.5 w-3.5" /> REQUEST PAYOUT
                </div>
                {!user.emailVerified ? (
                  <p className="mt-3 text-[11px] leading-relaxed tracking-wide text-red-400">
                    VERIFY YOUR EMAIL FIRST (CHECK YOUR INBOX FOR THE VERIFICATION LINK).
                  </p>
                ) : (
                  <>
                    <div className="mt-3 flex gap-2">
                      <Input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                        placeholder={`MIN ₹${Math.round(summary.minPayoutMinor / 100)}`}
                        inputMode="decimal"
                        className="h-10 border-stone-700 bg-black/60 tracking-wide placeholder:text-stone-700 focus-visible:ring-amber-500"
                        aria-label="Payout amount in rupees"
                      />
                      <Button
                        onClick={() => void requestPayout()}
                        disabled={payoutBusy || summary.balance.availableMinor < summary.minPayoutMinor}
                        className="h-10 border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500 disabled:opacity-40"
                      >
                        {payoutBusy ? '…' : 'REQUEST'}
                      </Button>
                    </div>
                    <div className="mt-2">
                      <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />
                    </div>
                    {payoutMsg && (
                      <p className="mt-2 text-[10px] leading-relaxed tracking-widest text-amber-500">{payoutMsg}</p>
                    )}
                    <p className="mt-2 text-[9px] leading-relaxed tracking-widest text-stone-600">
                      {summary.holdPeriodDays}-DAY HOLD BEFORE REVIEW · MANUAL APPROVAL ·
                      MIN {fmtMinor(summary.minPayoutMinor)} · BALANCE BELOW THE MINIMUM
                      CARRIES OVER
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* ------------------------------------------------ history */}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="mb-2 text-[10px] tracking-widest text-stone-500">
                  POINT LEDGER (NEWEST FIRST)
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {ledger.length === 0 && (
                        <tr>
                          <td className="py-3 text-center tracking-widest text-stone-600">
                            PLAY A RUN TO EARN YOUR FIRST POINTS
                          </td>
                        </tr>
                      )}
                      {ledger.map((ev) => (
                        <tr key={ev.id} className="border-b border-stone-900 last:border-0">
                          <td className="py-1.5 pr-2 text-stone-500">{fmtDate(ev.createdAt)}</td>
                          <td className="py-1.5 pr-2 tracking-wide text-stone-300">
                            {REASON_LABEL[ev.reason] ?? ev.reason}
                          </td>
                          <td
                            className={`py-1.5 text-right font-black ${
                              ev.points >= 0 ? 'text-amber-400' : 'text-red-500'
                            }`}
                          >
                            {ev.points >= 0 ? '+' : ''}
                            {ev.points}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border border-stone-800/80 bg-black/60 p-4">
                <div className="mb-2 text-[10px] tracking-widest text-stone-500">
                  PAYOUT HISTORY
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {payouts.length === 0 && (
                        <tr>
                          <td className="py-3 text-center tracking-widest text-stone-600">
                            NO PAYOUTS YET
                          </td>
                        </tr>
                      )}
                      {payouts.map((p) => (
                        <tr key={p.id} className="border-b border-stone-900 last:border-0">
                          <td className="py-1.5 pr-2 text-stone-500">{fmtDate(p.requestedAt)}</td>
                          <td className="py-1.5 pr-2 font-black text-emerald-400">
                            {fmtMinor(p.amountMinor)}
                          </td>
                          <td className="py-1.5 text-right">
                            <span
                              className={
                                p.status === 'PAID'
                                  ? 'text-emerald-500'
                                  : p.status === 'REJECTED'
                                    ? 'text-red-500'
                                    : 'text-amber-500'
                              }
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <p className="mt-6 text-center text-[9px] leading-relaxed tracking-[0.2em] text-stone-700">
              POINTS NEVER DEPEND ON ADS — ONLY ON GENUINE PLAY. PAYOUTS COME FROM A
              SHARE OF ACTUAL REVENUE AND CAN BE ZERO. SEE{' '}
              <Link href="/terms" className="text-stone-500 hover:text-stone-300">
                TERMS
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </main>
  )
}
