'use client'

// EU (ePrivacy/GDPR) + India (DPDP) consent banner placeholder.
//
// Ships DISABLED (NEXT_PUBLIC_CONSENT_BANNER=on enables it) because the site
// currently loads NO third-party scripts and sets no ad cookies — a banner
// with nothing to consent to is dark-pattern noise. The moment analytics or
// an ad network is activated: set the env, and have legal review the copy
// and the consent-scope wiring before launch (see business-documentation.md).

import { useEffect, useState } from 'react'
import Link from 'next/link'

const KEY = 'brutal.consent'
const ENABLED = process.env.NEXT_PUBLIC_CONSENT_BANNER === 'on'

export function ConsentBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!ENABLED) return
    try {
      if (!window.localStorage.getItem(KEY)) setShow(true)
    } catch {
      // storage blocked — do not nag
    }
  }, [])

  if (!ENABLED || !show) return null

  const decide = (v: 'all' | 'essential') => {
    try {
      window.localStorage.setItem(KEY, v)
    } catch {
      // ignore
    }
    setShow(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-[var(--line-strong)] bg-[var(--panel)] px-4 py-3"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 text-xs text-[var(--ink-dim)] sm:flex-row sm:items-center">
        <p className="flex-1 leading-relaxed">
          We use a single storage entry to remember your choice. Analytics and ad
          cookies (if ever enabled) load only after you agree. See our{' '}
          <Link href="/privacy" className="underline hover:text-[var(--ink)]">
            privacy policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide('essential')}
            className="rounded border border-[var(--line-strong)] px-3 py-1.5 text-[10px] tracking-widest text-[var(--ink-dim)] hover:text-[var(--ink)]"
          >
            ESSENTIAL ONLY
          </button>
          <button
            onClick={() => decide('all')}
            className="rounded border border-red-500/60 bg-red-600 px-3 py-1.5 text-[10px] font-bold tracking-widest text-white hover:bg-red-500"
          >
            ACCEPT ALL
          </button>
        </div>
      </div>
    </div>
  )
}
