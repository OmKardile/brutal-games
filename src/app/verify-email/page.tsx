'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react'

function VerifyInner() {
  const params = useSearchParams()
  const status = params.get('status')
  const [me, setMe] = useState<{ email: string; emailVerified: boolean } | null>(null)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe(d.user))
      .catch(() => undefined)
  }, [])

  const resend = async () => {
    if (resending) return
    setResending(true)
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' })
      if (res.ok) setResent(true)
    } finally {
      setResending(false)
    }
  }

  const ok = status === 'ok'

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#070709] px-4 font-mono text-stone-200">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-stone-500 transition-colors hover:text-red-400"
        >
          <ArrowLeft className="h-3 w-3" /> BACK TO SITE
        </Link>

        <div className="rounded border border-stone-800/80 bg-black/60 p-6 text-center">
          {ok ? (
            <>
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
              <h1 className="text-xl font-black tracking-tight text-emerald-400">EMAIL VERIFIED</h1>
              <p className="mb-5 mt-2 text-[11px] tracking-widest text-stone-500">
                PAYOUT REQUESTS ARE NOW UNLOCKED
              </p>
              <div className="flex flex-col gap-2">
                <Link href="/rewards">
                  <Button className="w-full border border-red-500/60 bg-red-600 font-black tracking-widest text-white hover:bg-red-500">
                    GO TO REWARDS
                  </Button>
                </Link>
                <Link href="/play">
                  <Button
                    variant="outline"
                    className="w-full border-stone-700 bg-transparent font-bold tracking-widest text-stone-300 hover:border-stone-500"
                  >
                    PLAY INSTEAD
                  </Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <XCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <h1 className="text-xl font-black tracking-tight text-red-500">
                {status === 'expired' ? 'LINK EXPIRED' : 'LINK INVALID'}
              </h1>
              <p className="mb-5 mt-2 text-[11px] tracking-widest text-stone-500">
                VERIFICATION LINKS LAST 72 HOURS AND WORK ONCE.
              </p>
              {me && !me.emailVerified && (
                <Button
                  onClick={() => void resend()}
                  disabled={resending || resent}
                  variant="outline"
                  className="w-full border-amber-800 bg-transparent font-bold tracking-widest text-amber-500 hover:border-amber-600"
                >
                  {resent ? 'NEW LINK SENT' : resending ? 'SENDING…' : 'SEND A NEW LINK'}
                </Button>
              )}
              <div className="mt-3 text-[10px] tracking-widest text-stone-600">
                <Link href="/login" className="hover:text-stone-400">
                  BACK TO LOGIN
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  )
}
