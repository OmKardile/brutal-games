'use client'

// Admin console — role-gated client page. All data flows through
// /api/admin/* routes which re-check the ADMIN role server-side.

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/hooks/use-session'
import { fmtMinor, fmtDate, fmtDateTime } from '@/lib/rewards/format'
import {
  ArrowLeft,
  BarChart3,
  Coins,
  Flag,
  Lock,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react'

// ---------------------------------------------------------------- types

interface Pool {
  id: string
  month: string
  netRevenueMinor: number
  sharePercent: number
  poolAmountMinor: number
  totalValidPoints: number
  leftoverMinor: number
  voidedMinor: number
  status: string
  lockedAt: string | null
  _count: { distributions: number }
}

interface PreviewDist {
  userId: string
  email: string
  points: number
  rawShareMinor: number
  cappedShareMinor: number
  capped: boolean
  frozen: boolean
}

interface Preview {
  month: string
  netRevenueMinor: number
  sharePercent: number
  poolAmountMinor: number
  totalValidPoints: number
  paidMinor: number
  leftoverMinor: number
  payoutCapMinor: number
  playerCount: number
  distributions: PreviewDist[]
}

interface PayoutRow {
  id: string
  amountMinor: number
  upiId: string
  status: string
  holdUntil: string | null
  requestedAt: string
  rejectedReason: string | null
  transactionRef: string | null
  user: { email: string; name: string | null }
}

interface FlagRow {
  id: string
  type: string
  severity: string
  status: string
  details: string | null
  createdAt: string
  user: { email: string; status: string }
}

interface UserRow {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  emailVerified: string | null
  upiId: string | null
  _count: { fraudFlags: number; payoutRequests: number }
}

interface UserDetail {
  user: UserRow & { adultDeclaredAt: string | null; createdAt: string }
  ledger: Array<{ id: string; points: number; reason: string; note: string | null; createdAt: string }>
  balance: { creditedMinor: number; reservedMinor: number; availableMinor: number }
  totalPoints: number
  payouts: PayoutRow[]
  flags: FlagRow[]
  distributions: Array<{ id: string; points: number; cappedShareMinor: number; pool: { month: string; status: string } }>
  devices: Array<{ id: string; fingerprint: string; ip: string | null; lastSeenAt: string }>
}

interface SettingsShape {
  REWARDS_ENABLED: boolean
  REWARDS_PAYOUTS_PAUSED: boolean
  TWO_PERSON_THRESHOLD_MINOR: number
  SHARE_PERCENT: number
  PAYOUT_CAP_MINOR: number
  MIN_PAYOUT_MINOR: number
  DAILY_POINT_CAP: number
  HEARTBEAT_INTERVAL_SEC: number
  HEARTBEAT_POINTS: number
  STREAK_BASE: number
  STREAK_MAX: number
  DAILY_CHALLENGE_POINTS: number
  HOLD_PERIOD_DAYS: number
  VPN_IP_LIST: string
  KYC_REQUIRED: boolean
}

// ---------------------------------------------------------------- page

export default function AdminPage() {
  const { me, loading } = useSession()
  const [tab, setTab] = useState('pool')

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#070709] font-mono text-stone-600">
        <p className="text-[11px] tracking-[0.4em]">LOADING…</p>
      </main>
    )
  }

  if (!me?.user || me.user.role !== 'ADMIN') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#070709] px-4 font-mono text-stone-200">
        <div className="w-full max-w-sm rounded border border-red-950 bg-black/60 p-6 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <h1 className="text-xl font-black tracking-tight text-red-500">ACCESS DENIED</h1>
          <p className="mt-2 text-[10px] tracking-[0.3em] text-stone-500">ADMIN ROLE REQUIRED</p>
          <Link href="/login" className="mt-4 inline-block text-[10px] tracking-widest text-amber-500 hover:text-amber-400">
            LOGIN AS ADMIN
          </Link>
        </div>
      </main>
    )
  }

  // phase 5: forced TOTP enrollment / short-lived admin session gate — checked
  // against a real admin route before any console surface renders
  return (
    <main className="min-h-dvh bg-[#070709] px-4 py-8 font-mono text-stone-200">
      <div className="mx-auto max-w-5xl">
        <AdminGate>
          <AdminConsole tab={tab} setTab={setTab} />
        </AdminGate>
      </div>
    </main>
  )
}

/** Probes /api/admin/settings: TOTP_SETUP_REQUIRED → enrollment flow,
 *  ADMIN_SESSION_EXPIRED → re-login with 2FA; otherwise renders children. */
function AdminGate({ children }: { children: React.ReactNode }) {
  const { refresh } = useSession()
  const [state, setState] = useState<'checking' | 'ok' | 'enroll' | 'expired'>('checking')
  const [secret, setSecret] = useState('')
  const [uri, setUri] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const probe = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' })
      if (res.ok) {
        setState('ok')
        return
      }
      const data = (await res.json()) as { code?: string }
      if (data.code === 'TOTP_SETUP_REQUIRED') setState('enroll')
      else if (data.code === 'ADMIN_SESSION_EXPIRED') setState('expired')
      else setState('expired')
    } catch {
      setState('expired')
    }
  }, [])

  useEffect(() => {
    void probe()
  }, [probe])

  if (state === 'checking') {
    return <p className="py-10 text-center text-[11px] tracking-[0.4em] text-stone-600">CHECKING ADMIN SESSION…</p>
  }
  if (state === 'ok') return <>{children}</>

  if (state === 'expired') {
    return (
      <div className="mx-auto max-w-sm rounded border border-amber-950 bg-black/60 p-6 text-center">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-black tracking-tight text-amber-500">ADMIN SESSION EXPIRED</h1>
        <p className="mt-2 text-[10px] leading-relaxed tracking-[0.25em] text-stone-500">
          ADMIN SESSIONS LAST 1 HOUR. LOG IN AGAIN WITH PASSWORD + 2FA CODE.
        </p>
        <Link href="/login" className="mt-4 inline-block text-[10px] tracking-widest text-amber-500 hover:text-amber-400">
          RE-AUTHENTICATE
        </Link>
      </div>
    )
  }

  const startSetup = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) {
        const d = (await res.json()) as { secret: string; uri: string }
        setSecret(d.secret)
        setUri(d.uri)
      } else {
        setMsg('Setup failed — re-login and retry.')
      }
    } finally {
      setBusy(false)
    }
  }

  const enable = async () => {
    if (busy || !/^\d{6}$/.test(code)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (res.ok) {
        await refresh()
        setState('expired') // token was issued pre-enable — re-login with 2FA now
        setMsg('2FA IS LIVE. LOG IN AGAIN WITH YOUR CODE.')
      } else {
        const d = (await res.json()) as { error?: string }
        setMsg(d.error ?? 'Wrong code.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded border border-amber-950 bg-black/60 p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-amber-500" />
        <h1 className="text-lg font-black tracking-tight text-amber-500">2FA SETUP REQUIRED</h1>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed tracking-[0.25em] text-stone-500">
        ADMIN ACTIONS REQUIRE TOTP TWO-FACTOR AUTH. ADD THE SECRET BELOW TO ANY
        AUTHENTICATOR APP (GOOGLE AUTHENTICATOR, AEGIS, 1PASSWORD…).
      </p>
      {!secret ? (
        <Button
          onClick={() => void startSetup()}
          disabled={busy}
          className="mt-4 h-11 w-full border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500"
        >
          {busy ? 'GENERATING…' : 'GENERATE SECRET'}
        </Button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded border border-stone-800 bg-black/80 p-3">
            <p className="text-[9px] tracking-widest text-stone-600">SECRET (BASE32 — KEEP IT OFFLINE)</p>
            <p className="mt-1 select-all break-all font-mono text-[12px] font-bold tracking-wider text-amber-400">{secret}</p>
            <p className="mt-3 text-[9px] tracking-widest text-stone-600">OTPAUTH URI</p>
            <p className="mt-1 select-all break-all text-[9px] leading-relaxed text-stone-400">{uri}</p>
          </div>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-DIGIT CODE FROM THE APP"
            inputMode="numeric"
            maxLength={6}
            className="h-11 border-amber-900/60 bg-black/60 tracking-[0.4em] focus-visible:ring-amber-500"
            aria-label="TOTP code"
          />
          <Button
            onClick={() => void enable()}
            disabled={busy || code.length !== 6}
            className="h-11 border border-emerald-600/60 bg-emerald-600 font-black tracking-widest text-black hover:bg-emerald-500"
          >
            {busy ? 'VERIFYING…' : 'ENABLE 2FA'}
          </Button>
        </div>
      )}
      {msg && <p className="mt-3 text-[10px] tracking-widest text-amber-500">{msg}</p>}
    </div>
  )
}

function AdminConsole({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const { me } = useSession()
  if (!me?.user) return null
  return (
    <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/"
              className="mb-2 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
            >
              <ArrowLeft className="h-3 w-3" /> BACK TO SITE
            </Link>
            <h1 className="text-3xl font-black tracking-tighter text-red-500">
              ADMIN<span className="text-stone-700">//</span>CONSOLE
            </h1>
          </div>
          <Badge variant="outline" className="border-red-900/60 text-[9px] tracking-[0.2em] text-stone-500">
            {me.user.email}
          </Badge>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-auto w-full grid-cols-8 gap-1 rounded border border-stone-800/80 bg-black/60 p-1">
            {[
              { v: 'pool', icon: Coins, label: 'POOL' },
              { v: 'payouts', icon: Wallet, label: 'PAYOUTS' },
              { v: 'flags', icon: Flag, label: 'FLAGS' },
              { v: 'boards', icon: Trophy, label: 'BOARDS' },
              { v: 'users', icon: Users, label: 'USERS' },
              { v: 'stats', icon: BarChart3, label: 'STATS' },
              { v: 'audit', icon: ScrollText, label: 'AUDIT' },
              { v: 'settings', icon: Settings, label: 'SETTINGS' },
            ].map((t) => (
              <TabsTrigger
                key={t.v}
                value={t.v}
                className="data-[state=active]:bg-red-950/60 data-[state=active]:text-red-400"
              >
                <t.icon className="mr-1 h-3.5 w-3.5" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="pool"><PoolTab /></TabsContent>
          <TabsContent value="payouts"><PayoutsTab /></TabsContent>
          <TabsContent value="flags"><FlagsTab /></TabsContent>
          <TabsContent value="boards"><BoardsTab /></TabsContent>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="stats"><StatsTab /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
        </Tabs>
    </>
  )
}

// ---------------------------------------------------------------- stats (slice 0)

interface StatsDay {
  dateKey: string
  players: number
  returning: number
  d1: number
}

interface StatsReport {
  tz: string
  days: StatsDay[]
  totals: {
    avgDau: number
    bestDau: number
    bestDauDate: string | null
    avgD1: number
    runsTotal: number
    rankedShare: number
  }
}

function StatsTab() {
  const [days, setDays] = useState('30')
  const [report, setReport] = useState<StatsReport | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (d: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/stats?days=${encodeURIComponent(d)}`, { cache: 'no-store' })
      if (res.ok) setReport((await res.json()) as StatsReport)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rounded border border-stone-800/80 bg-black/40 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-black tracking-[0.3em] text-stone-400">
          RETENTION READ-OUT <span className="text-stone-600">(DAU · D1 COHORTS)</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] tracking-widest text-stone-500">
          <span>WINDOW</span>
          {['7', '30', '90'].map((d) => (
            <Button
              key={d}
              size="sm"
              variant="outline"
              className={`h-7 px-2 text-[10px] ${days === d ? 'border-red-800 text-red-400' : 'border-stone-800 text-stone-500'}`}
              onClick={() => {
                setDays(d)
                void load(d)
              }}
            >
              {d}D
            </Button>
          ))}
          {busy && <span className="text-stone-600">…</span>}
        </div>
      </div>

      {report ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { label: 'AVG DAU', value: report.totals.avgDau },
              {
                label: 'BEST DAU',
                value: report.totals.bestDau,
                sub: report.totals.bestDauDate ?? undefined,
              },
              { label: 'AVG D1 %', value: `${report.totals.avgD1}%` },
              { label: 'RANKED SHARE', value: `${report.totals.rankedShare}%` },
            ].map((c) => (
              <div key={c.label} className="rounded border border-stone-800/80 bg-black/60 p-3">
                <div className="text-[9px] tracking-[0.25em] text-stone-600">{c.label}</div>
                <div className="mt-1 text-xl font-black text-red-400">{c.value}</div>
                {c.sub && <div className="text-[9px] text-stone-600">{c.sub}</div>}
              </div>
            ))}
          </div>
          <div className="text-[9px] tracking-[0.2em] text-stone-600">
            D1 = SHARE OF A DAY'S PLAYERS SEEN AGAIN LATER IN THE WINDOW · TZ {report.tz} ·
            RUNS {report.totals.runsTotal} · GUESTS COUNTED BY NAME KEY
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded border border-stone-800/80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-black/80">
                <tr className="text-left text-[9px] tracking-[0.25em] text-stone-500">
                  <th className="px-3 py-2">DAY</th>
                  <th className="px-3 py-2 text-right">PLAYERS</th>
                  <th className="px-3 py-2 text-right">RETURNED</th>
                  <th className="px-3 py-2 text-right">D1 %</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => (
                  <tr key={d.dateKey} className="border-t border-stone-800/60">
                    <td className="px-3 py-1.5 font-mono text-stone-400">{d.dateKey}</td>
                    <td className="px-3 py-1.5 text-right text-stone-300">{d.players}</td>
                    <td className="px-3 py-1.5 text-right text-stone-500">{d.returning}</td>
                    <td className="px-3 py-1.5 text-right text-red-400">{d.d1}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-[10px] tracking-[0.3em] text-stone-600">
          {busy ? 'COMPUTING COHORTS…' : 'NO DATA — TRY ANOTHER WINDOW'}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- pool

function PoolTab() {
  const now = new Date()
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(defaultMonth)
  const [revenue, setRevenue] = useState('')
  const [share, setShare] = useState('30')
  const [pools, setPools] = useState<Pool[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPools = useCallback(async () => {
    const res = await fetch('/api/admin/pool', { cache: 'no-store' })
    if (res.ok) setPools(((await res.json()) as { pools: Pool[] }).pools)
  }, [])

  useEffect(() => {
    void loadPools()
  }, [loadPools])

  const api = async (body: Record<string, unknown>) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { error?: string }
      setMsg(res.ok ? 'OK' : (data.error ?? 'Failed'))
      if (res.ok) await loadPools()
      return res.ok
    } finally {
      setBusy(false)
    }
  }

  const doPreview = async () => {
    setMsg(null)
    const res = await fetch(`/api/admin/pool/preview?month=${month}`, { cache: 'no-store' })
    if (res.ok) setPreview((await res.json()) as Preview)
    else setMsg('Preview failed.')
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid gap-3 rounded border border-stone-800/80 bg-black/60 p-4 md:grid-cols-5 md:items-end">
        <div className="md:col-span-1">
          <label className="text-[9px] tracking-widest text-stone-500">MONTH (IST)</label>
          <Input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="YYYY-MM"
            className="mt-1 h-10 border-stone-700 bg-black/60"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-[9px] tracking-widest text-stone-500">NET REVENUE ₹</label>
          <Input
            value={revenue}
            onChange={(e) => setRevenue(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="e.g. 12500.50"
            inputMode="decimal"
            className="mt-1 h-10 border-stone-700 bg-black/60"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-[9px] tracking-widest text-stone-500">SHARE %</label>
          <Input
            value={share}
            onChange={(e) => setShare(e.target.value.replace(/[^\d]/g, ''))}
            className="mt-1 h-10 border-stone-700 bg-black/60"
          />
        </div>
        <Button
          disabled={busy || !/^\d{4}-\d{2}$/.test(month) || !revenue}
          onClick={() =>
            void api({
              action: 'save',
              month,
              netRevenueMinor: Math.round(Number(revenue) * 100),
              sharePercent: Number(share) || 30,
            })
          }
          className="h-10 border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500 md:col-span-1"
        >
          SAVE REVENUE
        </Button>
        <Button
          disabled={busy || !/^\d{4}-\d{2}$/.test(month)}
          onClick={() => void doPreview()}
          variant="outline"
          className="h-10 border-stone-700 bg-transparent font-bold tracking-widest text-stone-300 md:col-span-1"
        >
          PREVIEW
        </Button>
      </div>

      {msg && <p className="text-[10px] tracking-widest text-amber-500">{msg}</p>}

      {preview && (
        <div className="rounded border border-stone-800/80 bg-black/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-black tracking-[0.2em] text-amber-400">
              PREVIEW {preview.month} — {preview.playerCount} PLAYERS
            </h3>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void api({ action: 'lock', month })}
              className="h-8 border border-red-500/60 bg-red-600 text-[10px] font-black tracking-widest text-white hover:bg-red-500"
            >
              <Lock className="mr-1 h-3 w-3" /> LOCK MONTH (FINAL)
            </Button>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-[10px] tracking-widest text-stone-500 md:grid-cols-5">
            <span>REVENUE: <b className="text-stone-300">{fmtMinor(preview.netRevenueMinor)}</b></span>
            <span>POOL ({preview.sharePercent}%): <b className="text-amber-400">{fmtMinor(preview.poolAmountMinor)}</b></span>
            <span>TOTAL PTS: <b className="text-stone-300">{preview.totalValidPoints}</b></span>
            <span>TO PAY: <b className="text-emerald-400">{fmtMinor(preview.paidMinor)}</b></span>
            <span>LEFTOVER: <b className="text-stone-500">{fmtMinor(preview.leftoverMinor)}</b></span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-black">
                <tr className="border-b border-stone-800 text-left text-stone-600">
                  <th className="py-1.5 pr-2 font-normal">PLAYER</th>
                  <th className="py-1.5 pr-2 font-normal">POINTS</th>
                  <th className="py-1.5 pr-2 font-normal">RAW</th>
                  <th className="py-1.5 font-normal">CAPPED</th>
                </tr>
              </thead>
              <tbody>
                {preview.distributions.map((d) => (
                  <tr key={d.userId} className="border-b border-stone-900">
                    <td className="py-1.5 pr-2 text-stone-300">
                      {d.email}
                      {d.frozen && <span className="ml-1 text-red-500">[FROZEN]</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-stone-400">{d.points}</td>
                    <td className="py-1.5 pr-2 text-stone-500">{fmtMinor(d.rawShareMinor)}</td>
                    <td className="py-1.5 font-black text-emerald-400">
                      {fmtMinor(d.cappedShareMinor)}
                      {d.capped && <span className="ml-1 text-[8px] text-red-500">CAPPED</span>}
                    </td>
                  </tr>
                ))}
                {preview.distributions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center tracking-widest text-stone-600">
                      NO POINTS THIS MONTH
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed tracking-widest text-stone-600">
            CAP LEFTOVER STAYS UNPAID IN THE POOL. LOCKING IS FINAL — THE SNAPSHOT
            NEVER RECOMPUTES.
          </p>
        </div>
      )}

      <div className="rounded border border-stone-800/80 bg-black/60 p-4">
        <h3 className="mb-2 text-[11px] font-black tracking-[0.2em] text-stone-400">ALL MONTHS</h3>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-stone-800 text-left text-stone-600">
              <th className="py-1.5 pr-2 font-normal">MONTH</th>
              <th className="py-1.5 pr-2 font-normal">REVENUE</th>
              <th className="py-1.5 pr-2 font-normal">POOL</th>
              <th className="py-1.5 pr-2 font-normal">PLAYERS</th>
              <th className="py-1.5 pr-2 font-normal">LEFTOVER</th>
              <th className="py-1.5 font-normal">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={p.id} className="border-b border-stone-900">
                <td className="py-1.5 pr-2 font-black text-stone-200">{p.month}</td>
                <td className="py-1.5 pr-2 text-stone-400">{fmtMinor(p.netRevenueMinor)}</td>
                <td className="py-1.5 pr-2 text-amber-400">{fmtMinor(p.poolAmountMinor)}</td>
                <td className="py-1.5 pr-2 text-stone-400">{p._count.distributions}</td>
                <td className="py-1.5 pr-2 text-stone-600">{fmtMinor(p.leftoverMinor)}</td>
                <td className="py-1.5">
                  <span className={p.status === 'LOCKED' ? 'text-emerald-500' : 'text-amber-500'}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
            {pools.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center tracking-widest text-stone-600">
                  NO POOLS YET — ENTER THE FIRST MONTH'S REVENUE ABOVE
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- payouts

function PayoutsTab() {
  const [rows, setRows] = useState<PayoutRow[]>([])
  const [filter, setFilter] = useState('PENDING')
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/payouts?status=${filter}`, { cache: 'no-store' })
    if (res.ok) setRows(((await res.json()) as { requests: PayoutRow[] }).requests)
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (body: Record<string, unknown>) => {
    let payload = body
    if (body.action === 'reject') {
      const reason = window.prompt('Rejection reason (shown to the player):')
      if (!reason) return
      payload = { ...body, reason }
    }
    if (body.action === 'paid') {
      const ref = window.prompt('Transaction reference (UPI reference no.):')
      if (!ref) return
      payload = { ...body, transactionRef: ref }
    }
    const res = await fetch('/api/admin/payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await res.json()) as { error?: string }
    setMsg(res.ok ? 'OK' : (data.error ?? 'Failed'))
    if (res.ok) await load()
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex gap-2">
        {['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'ALL'].map((s) => (
          <Button
            key={s}
            size="sm"
            variant="outline"
            onClick={() => setFilter(s === 'ALL' ? '' : s)}
            className={`h-8 text-[10px] tracking-widest ${
              filter === (s === 'ALL' ? '' : s)
                ? 'border-red-800 bg-red-950/60 text-red-400'
                : 'border-stone-800 bg-transparent text-stone-500'
            }`}
          >
            {s}
          </Button>
        ))}
      </div>
      {msg && <p className="text-[10px] tracking-widest text-amber-500">{msg}</p>}
      <div className="rounded border border-stone-800/80 bg-black/60 p-4">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-black">
              <tr className="border-b border-stone-800 text-left text-stone-600">
                <th className="py-1.5 pr-2 font-normal">REQUESTED</th>
                <th className="py-1.5 pr-2 font-normal">PLAYER</th>
                <th className="py-1.5 pr-2 font-normal">AMOUNT</th>
                <th className="py-1.5 pr-2 font-normal">UPI</th>
                <th className="py-1.5 pr-2 font-normal">HOLD UNTIL</th>
                <th className="py-1.5 pr-2 font-normal">STATUS</th>
                <th className="py-1.5 font-normal">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const holdActive = r.holdUntil ? new Date(r.holdUntil).getTime() > Date.now() : false
                return (
                  <tr key={r.id} className="border-b border-stone-900">
                    <td className="py-1.5 pr-2 text-stone-500">{fmtDateTime(r.requestedAt)}</td>
                    <td className="py-1.5 pr-2 text-stone-300">{r.user.email}</td>
                    <td className="py-1.5 pr-2 font-black text-emerald-400">{fmtMinor(r.amountMinor)}</td>
                    <td className="py-1.5 pr-2 text-stone-400">{r.upiId}</td>
                    <td className="py-1.5 pr-2 text-stone-500">
                      {r.holdUntil ? fmtDateTime(r.holdUntil) : '—'}
                      {holdActive && r.status === 'PENDING' && (
                        <span className="ml-1 text-[8px] text-red-500">ACTIVE</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={
                          r.status === 'PAID'
                            ? 'text-emerald-500'
                            : r.status === 'REJECTED'
                              ? 'text-red-500'
                              : 'text-amber-500'
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <div className="flex gap-1">
                        {r.status === 'PENDING' && (
                          <>
                            <Button
                              size="sm"
                              disabled={holdActive}
                              onClick={() => void act({ action: 'approve', id: r.id })}
                              className="h-6 bg-emerald-700 px-2 text-[9px] font-bold tracking-widest text-white hover:bg-emerald-600 disabled:opacity-40"
                            >
                              APPROVE
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void act({ action: 'reject', id: r.id })}
                              className="h-6 border-red-900 px-2 text-[9px] tracking-widest text-red-400"
                            >
                              REJECT
                            </Button>
                          </>
                        )}
                        {r.status === 'APPROVED' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void act({ action: 'paid', id: r.id })}
                              className="h-6 bg-emerald-700 px-2 text-[9px] font-bold tracking-widest text-white hover:bg-emerald-600"
                            >
                              MARK PAID
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void act({ action: 'reject', id: r.id })}
                              className="h-6 border-red-900 px-2 text-[9px] tracking-widest text-red-400"
                            >
                              REJECT
                            </Button>
                          </>
                        )}
                        {r.status === 'PAID' && (
                          <span className="text-[9px] text-stone-600">REF {r.transactionRef}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center tracking-widest text-stone-600">
                    NOTHING HERE
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- flags

function FlagsTab() {
  const [rows, setRows] = useState<FlagRow[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/flags', { cache: 'no-store' })
    if (res.ok) setRows(((await res.json()) as { flags: FlagRow[] }).flags)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: string, action: string) => {
    const res = await fetch('/api/admin/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    setMsg(res.ok ? 'OK' : 'Failed')
    if (res.ok) await load()
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {msg && <p className="text-[10px] tracking-widest text-amber-500">{msg}</p>}
      <div className="rounded border border-stone-800/80 bg-black/60 p-4">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-black">
              <tr className="border-b border-stone-800 text-left text-stone-600">
                <th className="py-1.5 pr-2 font-normal">RAISED</th>
                <th className="py-1.5 pr-2 font-normal">PLAYER</th>
                <th className="py-1.5 pr-2 font-normal">TYPE</th>
                <th className="py-1.5 pr-2 font-normal">SEV</th>
                <th className="py-1.5 pr-2 font-normal">DETAILS</th>
                <th className="py-1.5 font-normal">STATUS / ACTION</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-stone-900">
                  <td className="py-1.5 pr-2 text-stone-500">{fmtDateTime(f.createdAt)}</td>
                  <td className="py-1.5 pr-2 text-stone-300">{f.user.email}</td>
                  <td className="py-1.5 pr-2 tracking-wider text-amber-400">{f.type}</td>
                  <td
                    className={`py-1.5 pr-2 font-black ${
                      f.severity === 'HIGH' ? 'text-red-500' : f.severity === 'MEDIUM' ? 'text-amber-500' : 'text-stone-500'
                    }`}
                  >
                    {f.severity}
                  </td>
                  <td className="max-w-52 truncate py-1.5 pr-2 text-stone-600" title={f.details ?? ''}>
                    {f.details}
                  </td>
                  <td className="py-1.5">
                    {f.status === 'OPEN' || f.status === 'REVIEWING' ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void act(f.id, 'reviewing')}
                          className="h-6 border-stone-700 px-2 text-[9px] tracking-widest text-stone-400"
                        >
                          REVIEW
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void act(f.id, 'dismiss')}
                          className="h-6 border-stone-700 px-2 text-[9px] tracking-widest text-stone-400"
                        >
                          DISMISS
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void act(f.id, 'confirm')}
                          className="h-6 bg-red-800 px-2 text-[9px] tracking-widest text-white hover:bg-red-700"
                        >
                          CONFIRM
                        </Button>
                      </div>
                    ) : (
                      <span className={f.status === 'CONFIRMED' ? 'text-red-500' : 'text-stone-600'}>
                        {f.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center tracking-widest text-stone-600">
                    NO FLAGS — CLEAN HOUSE
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- boards

interface BoardEntry {
  id: string
  game: string
  name: string
  score: number
  wave?: number
  ranked: boolean
  pending: boolean
  createdAt: string
  user?: { id: string; email: string; name: string | null; status: string } | null
  removedAt?: string | null
  removedReason?: string | null
}

function BoardsTab() {
  const { toast } = useToast()
  const [pending, setPending] = useState<{ global: BoardEntry[]; daily: BoardEntry[] }>({ global: [], daily: [] })
  const [removed, setRemoved] = useState<{ global: BoardEntry[]; daily: BoardEntry[] }>({ global: [], daily: [] })
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/boards', { cache: 'no-store' })
      if (res.ok) {
        const d = (await res.json()) as {
          pendingGlobal: BoardEntry[]
          pendingDaily: BoardEntry[]
          removedGlobal: BoardEntry[]
          removedDaily: BoardEntry[]
        }
        setPending({ global: d.pendingGlobal, daily: d.pendingDaily })
        setRemoved({ global: d.removedGlobal, daily: d.removedDaily })
      }
    } catch {
      // keep stale
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (action: 'verify' | 'remove' | 'restore', board: 'global' | 'daily', id: string, reason?: string) => {
    setBusy(id)
    try {
      const res = await fetch('/api/admin/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, board, id, ...(action === 'remove' && reason ? { reason } : {}) }),
      })
      if (res.ok) {
        toast({ title: action.toUpperCase(), description: board === 'global' ? 'Global board entry updated.' : 'Daily entry updated.' })
        await load()
      }
    } finally {
      setBusy(null)
    }
  }

  const renderList = (title: string, entries: BoardEntry[], board: 'global' | 'daily', mode: 'pending' | 'removed') => (
    <div className="rounded border border-stone-800/80 bg-black/60 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] tracking-widest text-stone-500">
        <Trophy className="h-3.5 w-3.5" /> {title}
      </div>
      {entries.length === 0 && (
        <p className="py-2 text-[10px] tracking-widest text-stone-600">EMPTY</p>
      )}
      <div className="max-h-72 overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-2 border-b border-stone-900 py-1.5 last:border-0">
            <span className="w-14 shrink-0 text-[9px] tracking-widest text-stone-600">{e.game}</span>
            <span className="w-24 shrink-0 truncate text-[11px] font-bold text-stone-200">{e.name}</span>
            <span className="w-16 shrink-0 text-right text-[11px] font-black text-amber-400">
              {e.score.toLocaleString()}
            </span>
            <span className="hidden flex-1 truncate text-[9px] tracking-wide text-stone-600 sm:block">
              {e.user?.email ?? 'guest'} · {fmtDate(e.createdAt)}
              {mode === 'removed' && e.removedReason ? ` · ${e.removedReason}` : ''}
            </span>
            {mode === 'pending' ? (
              <span className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  disabled={busy === e.id}
                  onClick={() => void act('verify', board, e.id)}
                  className="h-7 border border-emerald-800/60 bg-emerald-900/40 px-2 text-[9px] font-bold tracking-widest text-emerald-300 hover:bg-emerald-900/70"
                >
                  VERIFY
                </Button>
                <Button
                  size="sm"
                  disabled={busy === e.id}
                  onClick={() => {
                    const reason = window.prompt('Removal reason (kept in the audit trail):')
                    if (reason && reason.trim().length >= 3) void act('remove', board, e.id, reason.trim())
                  }}
                  className="h-7 border border-red-900/60 bg-red-950/40 px-2 text-[9px] font-bold tracking-widest text-red-400 hover:bg-red-950/70"
                >
                  REMOVE
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                disabled={busy === e.id}
                onClick={() => void act('restore', board, e.id)}
                className="h-7 border border-stone-700 bg-transparent px-2 text-[9px] font-bold tracking-widest text-stone-300 hover:border-stone-500"
              >
                RESTORE
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {renderList('PENDING VERIFICATION — GLOBAL', pending.global, 'global', 'pending')}
      {renderList('PENDING VERIFICATION — DAILY', pending.daily, 'daily', 'pending')}
      {renderList('REMOVED (AUDIT) — GLOBAL', removed.global, 'global', 'removed')}
      {renderList('REMOVED (AUDIT) — DAILY', removed.daily, 'daily', 'removed')}
      <p className="col-span-full text-[9px] leading-relaxed tracking-widest text-stone-600">
        TOP-3 AND HIGH-RISK ENTRIES LAND HERE BEFORE THEY GO PUBLIC. REMOVED ENTRIES STAY IN
        THE DATABASE FOR AUDIT AND NEVER RENDER; RANKS RECOMPUTE AUTOMATICALLY. HONEST
        PLAYERS' PENDING ENTRIES AUTO-RELEASE AFTER 24H.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- users

function UsersTab() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<UserRow[]>([])
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)

  const search = useCallback(async () => {
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
    if (res.ok) setRows(((await res.json()) as { users: UserRow[] }).users)
  }, [q])

  useEffect(() => {
    void search()
  }, [search])

  const open = async (id: string) => {
    setSelectedEvents(new Set())
    const res = await fetch(`/api/admin/users/${id}`, { cache: 'no-store' })
    if (res.ok) setDetail((await res.json()) as UserDetail)
  }

  const userAction = async (body: Record<string, unknown>) => {
    if (!detail) return
    const res = await fetch(`/api/admin/users/${detail.user.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { error?: string }
    setMsg(res.ok ? 'OK' : (data.error ?? 'Failed'))
    if (res.ok) {
      await search()
      await open(detail.user.id)
    }
  }

  const voidSelected = async () => {
    if (!detail || selectedEvents.size === 0) return
    const reason = window.prompt(`Void ${selectedEvents.size} event(s) — reason:`)
    if (!reason) return
    await userAction({ action: 'void', eventIds: [...selectedEvents], reason })
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-600" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SEARCH EMAIL / NAME"
            className="h-10 border-stone-700 bg-black/60 pl-8 tracking-widest placeholder:text-stone-700"
          />
        </div>
      </div>
      {msg && <p className="text-[10px] tracking-widest text-amber-500">{msg}</p>}

      <div className="rounded border border-stone-800/80 bg-black/60 p-4">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-stone-800 text-left text-stone-600">
              <th className="py-1.5 pr-2 font-normal">EMAIL</th>
              <th className="py-1.5 pr-2 font-normal">ROLE</th>
              <th className="py-1.5 pr-2 font-normal">STATUS</th>
              <th className="py-1.5 pr-2 font-normal">FLAGS</th>
              <th className="py-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="cursor-pointer border-b border-stone-900 hover:bg-stone-950/40">
                <td className="py-1.5 pr-2 text-stone-300" onClick={() => void open(u.id)}>
                  {u.email}
                  {!u.emailVerified && <span className="ml-1 text-[8px] text-red-500">UNVERIFIED</span>}
                </td>
                <td className="py-1.5 pr-2 text-stone-500">{u.role}</td>
                <td className="py-1.5 pr-2">
                  <span className={u.status === 'FROZEN' ? 'text-red-500' : 'text-emerald-500'}>{u.status}</span>
                </td>
                <td className="py-1.5 pr-2 text-amber-500">{u._count.fraudFlags}</td>
                <td className="py-1.5 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void open(u.id)}
                    className="h-6 border-stone-700 px-2 text-[9px] tracking-widest text-stone-400"
                  >
                    OPEN
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="rounded border border-amber-900/40 bg-black/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[12px] font-black tracking-widest text-amber-400">
                {detail.user.email}
              </h3>
              <p className="text-[9px] tracking-widest text-stone-500">
                LIFETIME {detail.totalPoints} PTS · CREDITED {fmtMinor(detail.balance.creditedMinor)} ·
                AVAILABLE {fmtMinor(detail.balance.availableMinor)} ·{' '}
                {detail.user.adultDeclaredAt ? '18+ OK' : 'NO 18+'} · UPI {detail.user.upiId ?? '—'}
              </p>
            </div>
            <div className="flex gap-2">
              {detail.user.status === 'ACTIVE' ? (
                <Button
                  size="sm"
                  onClick={() => void userAction({ action: 'freeze' })}
                  className="h-7 bg-red-800 text-[9px] font-bold tracking-widest text-white hover:bg-red-700"
                >
                  FREEZE
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void userAction({ action: 'unfreeze' })}
                  className="h-7 bg-emerald-700 text-[9px] font-bold tracking-widest text-white hover:bg-emerald-600"
                >
                  UNFREEZE
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={selectedEvents.size === 0}
                onClick={() => void voidSelected()}
                className="h-7 border-red-900 text-[9px] tracking-widest text-red-400"
              >
                VOID {selectedEvents.size} EVENTS
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] tracking-widest text-stone-500">
                LEDGER (SELECT TO VOID — POSITIVE ROWS ONLY)
              </div>
              <div className="max-h-56 overflow-y-auto rounded border border-stone-900">
                <table className="w-full text-[10px]">
                  <tbody>
                    {detail.ledger.map((ev) => (
                      <tr key={ev.id} className="border-b border-stone-900 last:border-0">
                        <td className="w-6 py-1 pl-1.5">
                          <input
                            type="checkbox"
                            disabled={ev.points <= 0}
                            checked={selectedEvents.has(ev.id)}
                            onChange={(e) => {
                              const next = new Set(selectedEvents)
                              if (e.target.checked) next.add(ev.id)
                              else next.delete(ev.id)
                              setSelectedEvents(next)
                            }}
                            className="h-3 w-3 accent-red-500"
                          />
                        </td>
                        <td className="py-1 text-stone-600">{fmtDateTime(ev.createdAt)}</td>
                        <td className="py-1 text-stone-400">{ev.reason}</td>
                        <td
                          className={`py-1 pr-1.5 text-right font-black ${
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
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1 text-[10px] tracking-widest text-stone-500">PAYOUTS</div>
                <div className="max-h-24 overflow-y-auto rounded border border-stone-900 p-2 text-[10px] text-stone-400">
                  {detail.payouts.length === 0 && 'NONE'}
                  {detail.payouts.map((p) => (
                    <div key={p.id} className="flex justify-between">
                      <span>{fmtDate(p.requestedAt)}</span>
                      <span className="text-emerald-400">{fmtMinor(p.amountMinor)}</span>
                      <span>{p.status}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] tracking-widest text-stone-500">DISTRIBUTIONS</div>
                <div className="max-h-24 overflow-y-auto rounded border border-stone-900 p-2 text-[10px] text-stone-400">
                  {detail.distributions.length === 0 && 'NONE'}
                  {detail.distributions.map((d) => (
                    <div key={d.id} className="flex justify-between">
                      <span>{d.pool.month}</span>
                      <span>{d.points} PTS</span>
                      <span className="text-emerald-400">{fmtMinor(d.cappedShareMinor)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] tracking-widest text-stone-500">DEVICES</div>
                <div className="max-h-24 overflow-y-auto rounded border border-stone-900 p-2 text-[10px] text-stone-500">
                  {detail.devices.length === 0 && 'NONE'}
                  {detail.devices.map((d) => (
                    <div key={d.id} className="flex justify-between">
                      <span>{d.fingerprint}…</span>
                      <span>{d.ip ?? '—'}</span>
                      <span>{fmtDate(d.lastSeenAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- audit

interface AuditRow {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  before: string | null
  after: string | null
  createdAt: string
  admin: { id: string; email: string; name: string | null }
}

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/audit', { cache: 'no-store' })
        if (res.ok) setRows(((await res.json()) as { audit: AuditRow[] }).audit)
      } catch {
        // stale
      }
    })()
  }, [])

  return (
    <div className="mt-3 rounded border border-stone-800/80 bg-black/60 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] tracking-widest text-stone-500">
        <ScrollText className="h-3.5 w-3.5" /> ADMIN AUDIT TRAIL (APPEND-ONLY, NEWEST FIRST)
      </div>
      {rows.length === 0 && (
        <p className="py-2 text-[10px] tracking-widest text-stone-600">NO ACTIONS RECORDED YET</p>
      )}
      <div className="max-h-[32rem] overflow-y-auto">
        <table className="w-full text-[10px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-stone-900 align-top last:border-0">
                <td className="w-28 py-1.5 pr-2 text-stone-600">{fmtDateTime(r.createdAt)}</td>
                <td className="w-32 py-1.5 pr-2 text-stone-500">{r.admin.email}</td>
                <td className="w-36 py-1.5 pr-2 font-bold tracking-wider text-amber-400">{r.action}</td>
                <td className="w-16 py-1.5 pr-2 text-stone-600">{r.targetType ?? '—'}</td>
                <td className="py-1.5 break-all text-stone-400">
                  {r.after ? r.after.slice(0, 160) : r.targetId ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- settings

const NUM_FIELDS: Array<{ key: keyof SettingsShape; label: string; hint: string }> = [
  { key: 'SHARE_PERCENT', label: 'SHARE %', hint: '% of net monthly revenue → pool' },
  { key: 'PAYOUT_CAP_MINOR', label: 'PAYOUT CAP (PAISE)', hint: 'per-player monthly cap' },
  { key: 'MIN_PAYOUT_MINOR', label: 'MIN PAYOUT (PAISE)', hint: 'below this, balance carries over' },
  { key: 'DAILY_POINT_CAP', label: 'DAILY POINT CAP', hint: 'per player per day' },
  { key: 'HEARTBEAT_INTERVAL_SEC', label: 'HEARTBEAT SEC', hint: 'beats faster than this are rejected' },
  { key: 'HEARTBEAT_POINTS', label: 'HEARTBEAT PTS', hint: 'points per validated beat' },
  { key: 'STREAK_BASE', label: 'STREAK BASE', hint: 'day-1 streak award' },
  { key: 'STREAK_MAX', label: 'STREAK MAX', hint: 'max streak award' },
  { key: 'DAILY_CHALLENGE_POINTS', label: 'CHALLENGE PTS', hint: 'daily challenge award' },
  { key: 'HOLD_PERIOD_DAYS', label: 'HOLD DAYS', hint: 'payout hold before approval' },
]

function SettingsTab() {
  const [settings, setSettings] = useState<SettingsShape | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetch('/api/admin/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSettings(d.settings))
      .catch(() => undefined)
  }, [])

  const save = async () => {
    if (!settings || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = (await res.json()) as { error?: string; settings?: SettingsShape }
      if (res.ok && data.settings) {
        setSettings(data.settings)
        setMsg('SAVED')
      } else {
        setMsg(data.error ?? 'Failed')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <p className="mt-4 text-[11px] tracking-widest text-stone-600">LOADING…</p>

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="rounded border border-red-950 bg-black/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[12px] font-black tracking-[0.2em] text-red-400">
              MASTER FLAG — REWARDS_ENABLED
            </h3>
            <p className="mt-1 text-[10px] tracking-widest text-stone-500">
              WHEN OFF: NO POINTS ARE EARNED AND ALL REWARD UI IS HIDDEN.
            </p>
          </div>
          <Switch
            checked={settings.REWARDS_ENABLED}
            onCheckedChange={(v) => setSettings({ ...settings, REWARDS_ENABLED: v })}
            className="data-[state=checked]:bg-emerald-600"
          />
        </div>
      </div>

      <div className="rounded border border-amber-950 bg-black/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[12px] font-black tracking-[0.2em] text-amber-400">
              KILL SWITCH — REWARDS_PAYOUTS_PAUSED
            </h3>
            <p className="mt-1 text-[10px] tracking-widest text-stone-500">
              FREEZES PAYOUT CREATION + APPROVAL WITHOUT TOUCHING POINT EARNING.
              FLIP DURING AN INCIDENT — NO REDEPLOY NEEDED.
            </p>
          </div>
          <Switch
            checked={settings.REWARDS_PAYOUTS_PAUSED}
            onCheckedChange={(v) => setSettings({ ...settings, REWARDS_PAYOUTS_PAUSED: v })}
            className="data-[state=checked]:bg-red-600"
          />
        </div>
      </div>

      <div className="rounded border border-amber-950 bg-black/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[12px] font-black tracking-[0.2em] text-amber-400">
              KILL SWITCH — REWARDS_PAYOUTS_PAUSED
            </h3>
            <p className="mt-1 text-[10px] tracking-widest text-stone-500">
              FREEZES ALL PAYOUT CREATION + APPROVAL WITHOUT TOUCHING POINT
              EARNING. FLIP DURING AN INCIDENT — NO REDEPLOY NEEDED.
            </p>
          </div>
          <Switch
            checked={settings.REWARDS_PAYOUTS_PAUSED}
            onCheckedChange={(v) => setSettings({ ...settings, REWARDS_PAYOUTS_PAUSED: v })}
            className="data-[state=checked]:bg-red-600"
          />
        </div>
      </div>

      <div className="grid gap-3 rounded border border-stone-800/80 bg-black/60 p-4 md:grid-cols-2">
        {NUM_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="text-[9px] tracking-widest text-stone-500">
              {f.label} — <span className="text-stone-700">{f.hint}</span>
            </label>
            <Input
              value={String(settings[f.key])}
              onChange={(e) =>
                setSettings({ ...settings, [f.key]: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })
              }
              className="mt-1 h-10 border-stone-700 bg-black/60"
            />
          </div>
        ))}
        <div className="md:col-span-2">
          <label className="text-[9px] tracking-widest text-stone-500">
            VPN / DATACENTER IP LIST — comma-separated IPs or IPv4 CIDRs (flag for review)
          </label>
          <Input
            value={settings.VPN_IP_LIST}
            onChange={(e) => setSettings({ ...settings, VPN_IP_LIST: e.target.value })}
            placeholder="1.2.3.4, 10.0.0.0/8"
            className="mt-1 h-10 border-stone-700 bg-black/60"
          />
        </div>
      </div>

      {msg && <p className="text-[10px] tracking-widest text-amber-500">{msg}</p>}
      <Button
        onClick={() => void save()}
        disabled={busy}
        className="h-11 self-start border border-amber-600/60 bg-amber-600 font-black tracking-widest text-black hover:bg-amber-500"
      >
        {busy ? 'SAVING…' : 'SAVE SETTINGS'}
      </Button>
    </div>
  )
}
