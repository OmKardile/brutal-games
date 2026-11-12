'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { ArrowLeft, LogIn } from 'lucide-react'

function collectSignals() {
  return {
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${window.screen.width}x${window.screen.height} x${window.devicePixelRatio}`,
    platform: (navigator as unknown as { platform?: string }).platform ?? '',
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
  }
}

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [googleEnabled, setGoogleEnabled] = useState(false)

  useEffect(() => {
    void fetch('/api/rewards/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setGoogleEnabled(Boolean(c.googleEnabled)))
      .catch(() => undefined)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, signals: collectSignals() }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Login failed.')
        return
      }
      toast({ title: 'WELCOME BACK, PILOT', description: 'Session opened.' })
      router.push('/rewards')
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#070709] px-4 font-mono text-stone-200">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO SITE
        </Link>

        <div className="rounded border border-stone-800/80 bg-black/60 p-6">
          <h1 className="text-2xl font-black tracking-tight text-red-500">PILOT LOGIN</h1>
          <p className="mb-5 mt-1 text-[10px] tracking-[0.25em] text-stone-500">
            EARN REWARD POINTS · REQUEST PAYOUTS
          </p>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pilot@arena.dev"
              className="h-11 border-red-900/60 bg-black/60 tracking-wide placeholder:text-stone-700 focus-visible:ring-red-500"
              aria-label="Email"
            />
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="PASSWORD"
              className="h-11 border-red-900/60 bg-black/60 tracking-wide placeholder:text-stone-700 focus-visible:ring-red-500"
              aria-label="Password"
            />
            {error && (
              <p className="text-[11px] tracking-widest text-red-500">{error}</p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="h-11 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500 disabled:opacity-50"
            >
              <LogIn className="mr-2 h-4 w-4" /> {busy ? 'AUTHENTICATING…' : 'LOGIN'}
            </Button>
          </form>

          {googleEnabled && (
            <>
              <div className="my-4 flex items-center gap-3 text-[9px] tracking-[0.3em] text-stone-700">
                <span className="h-px flex-1 bg-stone-800" /> OR <span className="h-px flex-1 bg-stone-800" />
              </div>
              <a href="/api/auth/google/start" className="block">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full border-stone-700 bg-transparent font-bold tracking-widest text-stone-300 hover:border-stone-500 hover:bg-stone-900/40"
                >
                  CONTINUE WITH GOOGLE
                </Button>
              </a>
            </>
          )}

          <div className="mt-5 flex flex-col gap-1.5 text-[10px] tracking-widest text-stone-600">
            <span>
              NO ACCOUNT?{' '}
              <Link href="/signup" className="text-amber-500 hover:text-amber-400">
                SIGN UP
              </Link>
            </span>
            <span>
              FORGOT PASSWORD?{' '}
              <Link href="/forgot-password" className="text-stone-400 hover:text-stone-200">
                RESET
              </Link>
            </span>
          </div>
        </div>

        <p className="mt-4 text-center text-[9px] tracking-[0.2em] text-stone-700">
          PLAYING NEEDS NO ACCOUNT — LOGIN ONLY UNLOCKS REWARDS
        </p>
      </div>
    </main>
  )
}
