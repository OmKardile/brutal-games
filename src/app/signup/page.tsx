'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Turnstile } from '@/components/Turnstile'
import { ArrowLeft, UserPlus } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>(undefined)
  const [siteKey, setSiteKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devNote, setDevNote] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/rewards/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setSiteKey(c.turnstileSiteKey ?? ''))
      .catch(() => undefined)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (siteKey && !turnstileToken) {
      setError('Complete the captcha first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
          turnstileToken,
          signals: {
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            screen: `${window.screen.width}x${window.screen.height} x${window.devicePixelRatio}`,
            platform: (navigator as unknown as { platform?: string }).platform ?? '',
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
          },
        }),
      })
      const data = (await res.json()) as { error?: string; verificationEmailSent?: boolean }
      if (!res.ok) {
        setError(data.error ?? 'Signup failed.')
        return
      }
      if (!data.verificationEmailSent) {
        setDevNote('Dev mode: the verification link was printed to the server console.')
      }
      router.push(`/rewards${data.verificationEmailSent ? '' : '?verify=dev'}`)
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#070709] px-4 py-8 font-mono text-stone-200">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO SITE
        </Link>

        <div className="rounded border border-stone-800/80 bg-black/60 p-6">
          <h1 className="text-2xl font-black tracking-tight text-red-500">ENLIST</h1>
          <p className="mb-5 mt-1 text-[10px] tracking-[0.25em] text-stone-500">
            ONE ACCOUNT PER PERSON · FRAUD VOIDS REWARDS
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
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="CALLSIGN (OPTIONAL — YOUR BOARD NAME)"
              maxLength={16}
              className="h-11 border-red-900/60 bg-black/60 tracking-widest placeholder:text-stone-700 focus-visible:ring-red-500"
              aria-label="Callsign"
            />
            <Input
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="PASSWORD (10+ CHARS)"
              className="h-11 border-red-900/60 bg-black/60 tracking-wide placeholder:text-stone-700 focus-visible:ring-red-500"
              aria-label="Password"
            />
            <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />
            {error && <p className="text-[11px] tracking-widest text-red-500">{error}</p>}
            {devNote && <p className="text-[10px] tracking-widest text-amber-600">{devNote}</p>}
            <Button
              type="submit"
              disabled={busy}
              className="h-11 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500 disabled:opacity-50"
            >
              <UserPlus className="mr-2 h-4 w-4" /> {busy ? 'ENLISTING…' : 'CREATE ACCOUNT'}
            </Button>
          </form>

          <div className="mt-5 text-[10px] tracking-widest text-stone-600">
            ALREADY ENLISTED?{' '}
            <Link href="/login" className="text-amber-500 hover:text-amber-400">
              LOGIN
            </Link>
          </div>
        </div>

        <p className="mt-4 text-center text-[9px] leading-relaxed tracking-[0.2em] text-stone-700">
          BY SIGNING UP YOU ACCEPT THE{' '}
          <Link href="/terms" className="text-stone-500 underline-offset-2 hover:underline">
            TERMS
          </Link>{' '}
          AND{' '}
          <Link href="/privacy" className="text-stone-500 underline-offset-2 hover:underline">
            PRIVACY POLICY
          </Link>
        </p>
      </div>
    </main>
  )
}
