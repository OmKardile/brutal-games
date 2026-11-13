'use client'

// BRUTAL — global NIGHT / DAY theme for the whole site AND every game canvas.
//
// 'night' (default): the classic pitch-black brutal look.
// 'day': bone-white "poster" mode — same identity, inverted surfaces.
//
// The mode lives on <html data-theme="..."> so CSS variables and the game
// engines (via their own palettes) can both read it. Persisted in localStorage;
// an inline pre-paint script in layout.tsx applies it to avoid a flash.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type ThemeMode = 'night' | 'day'

const LS_KEY = 'brutal.theme'

interface ThemeCtx {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ theme: 'night', setTheme: () => {}, toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('night')

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LS_KEY)
      if (saved === 'day' || saved === 'night') setThemeState(saved)
    } catch {
      // storage unavailable — night stays default
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(LS_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), [])
  const toggle = useCallback(() => setThemeState((t) => (t === 'night' ? 'day' : 'night')), [])

  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx)
}
