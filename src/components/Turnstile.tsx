'use client'

// Cloudflare Turnstile widget. Renders nothing when no site key is
// configured (dev) — the server bypasses verification in that case too.

import { useCallback, useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
        },
      ) => string
      reset: (id?: string) => void
    }
    _turnstileLoading?: Promise<void>
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (window._turnstileLoading) return window._turnstileLoading
  window._turnstileLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('turnstile script failed to load'))
    document.head.appendChild(s)
  })
  return window._turnstileLoading
}

export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string | undefined) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)
  const [failed, setFailed] = useState(false)

  const handleToken = useCallback(
    (t: string) => {
      setFailed(false)
      onToken(t)
    },
    [onToken],
  )

  useEffect(() => {
    if (!siteKey || !ref.current) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: handleToken,
          'error-callback': () => setFailed(true),
          'expired-callback': () => onToken(undefined),
          theme: 'dark',
        })
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
    }
  }, [siteKey, handleToken, onToken])

  if (!siteKey) {
    return (
      <p className="text-[10px] tracking-widest text-stone-600">
        CAPTCHA DISABLED (DEV)
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div ref={ref} />
      {failed && (
        <p className="text-[10px] tracking-widest text-red-500">
          CAPTCHA FAILED TO LOAD — CHECK YOUR CONNECTION AND RELOAD
        </p>
      )}
    </div>
  )
}
