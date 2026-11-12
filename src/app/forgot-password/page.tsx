'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, KeyRound } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [devNote, setDevNote] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setDevNote(false)
        return
      }
      // dev mode: reset link goes to the server console, not a real inbox
      setDevNote(!process.env.NEXT_PUBLIC_MAIL)
      setSent(true)
    } catch {
      // same silent response
      setSent(true)
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
          <h1 className="text-2xl font-black tracking-tight text-red-500">RESET PASSWORD</h1>
          <p className="mb-5 mt-1 text-[10px] tracking-[0.25em] text-stone-500">
            WE'LL SEND A ONE-TIME LINK (1H EXPIRY)
          </p>

          {sent ? (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] leading-relaxed tracking-wide text-emerald-400">
                IF THAT EMAIL EXISTS, A RESET LINK IS ON ITS WAY.
              </p>
              {devNote && (
                <p className="text-[10px] leading-relaxed tracking-widest text-amber-600">
                  DEV MODE: NO MAIL PROVIDER CONFIGURED — THE LINK WAS PRINTED TO THE
                  SERVER CONSOLE.
                </p>
              )}
              <Link href="/login">
                <Button
                  variant="outline"
                  className="w-full border-stone-700 bg-transparent font-bold tracking-widest text-stone-300 hover:border-stone-500"
                >
                  BACK TO LOGIN
                </Button>
              </Link>
            </div>
          ) : (
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
              <Button
                type="submit"
                disabled={busy}
                className="h-11 border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500 disabled:opacity-50"
              >
                <KeyRound className="mr-2 h-4 w-4" /> {busy ? 'SENDING…' : 'SEND RESET LINK'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
