'use client'

// PWA registration + install prompt (roadmap slice 2).
//
// Registers /sw.js in production ONLY (a dev-loop SW cache is a footgun),
// and surfaces a small INSTALL button when the browser fires
// beforeinstallprompt (Android Chrome; iOS Safari shows Add to Home Screen
// from the share sheet — a hint line covers it). The component renders
// NOTHING until an install is actually available.

import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NODE_ENV !== 'production') return // dev: no SW caching

    if ('serviceWorker' in navigator) {
      const onLoad = () => {
        navigator.serviceWorker
          .register(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sw.js`)
          .catch(() => undefined) // SW is progressive enhancement — fail soft
      }
      if (document.readyState === 'complete') onLoad()
      else window.addEventListener('load', onLoad, { once: true })
      return () => window.removeEventListener('load', onLoad)
    }
  }, [])

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // keep our own button in charge
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setInstallEvent(null)
  }, [installEvent])

  if (installed || !installEvent) return null

  return (
    <button
      onClick={() => void install()}
      className="inline-flex items-center gap-1.5 rounded border border-emerald-800/60 bg-emerald-950/40 px-2.5 py-1 text-[9px] font-black tracking-[0.3em] text-emerald-400 transition-colors hover:bg-emerald-900/40"
      aria-label="Install the game arcade as an app"
    >
      <Download className="h-3 w-3" /> INSTALL APP
    </button>
  )
}
