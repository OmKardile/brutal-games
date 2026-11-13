// game-kit — safe storage wrapper.
//
// localStorage/sessionStorage can throw at ANY call: Safari private mode,
// disabled cookies, storage quota, security policy. Every access is wrapped in
// try/catch and falls back to an in-memory Map, so games never crash in
// incognito — they just don't persist.

export interface SafeStorage {
  /** true when the underlying browser storage works */
  readonly available: boolean
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function wrapMemory(): SafeStorage {
  const mem = new Map<string, string>()
  return {
    available: false,
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => void mem.set(k, v),
    remove: (k) => void mem.delete(k),
  }
}

function wrapReal(store: Storage): SafeStorage {
  return {
    available: true,
    get(k) {
      try {
        return store.getItem(k)
      } catch {
        return null
      }
    },
    set(k, v) {
      try {
        store.setItem(k, v)
      } catch {
        // quota / privacy mode — drop silently
      }
    },
    remove(k) {
      try {
        store.removeItem(k)
      } catch {
        // ignore
      }
    },
  }
}

/** localStorage with in-memory fallback. Call inside a browser context. */
export function safeLocal(): SafeStorage {
  if (typeof window === 'undefined') return wrapMemory()
  try {
    // probe: some browsers only throw on first use
    const probe = '__brutal_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return wrapReal(window.localStorage)
  } catch {
    return wrapMemory()
  }
}

/** sessionStorage with in-memory fallback. */
export function safeSession(): SafeStorage {
  if (typeof window === 'undefined') return wrapMemory()
  try {
    const probe = '__brutal_probe__'
    window.sessionStorage.setItem(probe, '1')
    window.sessionStorage.removeItem(probe)
    return wrapReal(window.sessionStorage)
  } catch {
    return wrapMemory()
  }
}

/** JSON helpers that never throw — unreadable/corrupt values return fallback. */
export function getJson<T>(store: SafeStorage, key: string, fallback: T): T {
  const raw = store.get(key)
  if (raw == null) return fallback
  try {
    const parsed = JSON.parse(raw) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function setJson(store: SafeStorage, key: string, value: unknown): void {
  try {
    store.set(key, JSON.stringify(value))
  } catch {
    // circular or huge — drop silently
  }
}

/** Integer read helper (e.g. local bests). Returns fallback on junk. */
export function getInt(store: SafeStorage, key: string, fallback = 0): number {
  const raw = store.get(key)
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function setInt(store: SafeStorage, key: string, value: number): void {
  store.set(key, String(Math.trunc(value)))
}
