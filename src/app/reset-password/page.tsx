'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

function ResetForm() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Reset failed.')
        return
      }
      setDone(true)
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
          href="/login"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO LOGIN
        </Link>

        <div className="rounded border border-stone-800/80 bg-black/60 p-6">
          <h1 className="text-2xl font-black tracking-tight text-red-500">NEW PASSWORD</h1>
          <p className="mb-5 mt-1 text-[10px] tracking-[0.25em] text-stone-500">
            ALL OTHER SESSIONS WILL BE LOGGED OUT
          </p>

          {!token ? (
            <p className="text-[12px] tracking-widest text-red-500">
              MISSING RESET TOKEN — USE THE LINK FROM YOUR EMAIL.
            </p>
          ) : done ? (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-[12px] tracking-widest text-emerald-400">
                <ShieldCheck className="h-4 w-4" /> PASSWORD UPDATED — LOG IN AGAIN.
              </p>
              <Link href="/login">
                <Button className="w-full border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500">
                  GO TO LOGIN
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="NEW PASSWORD (8+ CHARS)"
                className="h-11 border-red-900/60 bg-black/60 tracking-wide placeholder:text-stone-700 focus-visible:ring-red-500"
                aria-label="New password"
              />
              {error && <p className="text-[11px] tracking-widest text-red-500">{error}</p>}
              <Button
                type="submit"
                disabled={busy}
                className="h-11 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500 disabled:opacity-50"
              >
                {busy ? 'SETTING…' : 'SET NEW PASSWORD'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  )
}
