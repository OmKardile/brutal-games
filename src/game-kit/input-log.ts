// game-kit — compact input-log recorder.
//
// Records real player input (keydown / pointerdown / touchstart) with
// millisecond offsets into a compact string, size-capped, for future replay
// verification of daily runs. v1 LIMITATION (documented): logs are stored but
// never verified server-side — this is the evidence trail, not the judge.

export interface InputRecorder {
  start(): void
  stop(): string | null
}

const MAX_ENTRIES = 900

export function createInputRecorder(maxChars = 16_384): InputRecorder {
  let entries: string[] = []
  let t0 = 0
  let attached = false
  let lastKey = ''

  const push = (code: string): void => {
    if (entries.length >= MAX_ENTRIES) return
    entries.push(`${code}@${Math.round(performance.now() - t0)}`)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    const code = `k:${e.code}`
    if (code === lastKey) return // key repeat noise
    lastKey = code
    push(code)
  }
  const onKeyUp = (): void => {
    lastKey = ''
  }
  const onPointer = (e: PointerEvent): void => {
    const r = (e.currentTarget as Window | typeof window).length // no-op touch to keep types honest
    void r
    push(`p:${Math.round(e.clientX)},${Math.round(e.clientY)}`)
  }
  const onTouch = (e: TouchEvent): void => {
    const t = e.touches[0] ?? e.changedTouches[0]
    if (t) push(`t:${Math.round(t.clientX)},${Math.round(t.clientY)}`)
  }

  return {
    start(): void {
      if (attached || typeof window === 'undefined') return
      attached = true
      entries = []
      t0 = performance.now()
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('pointerdown', onPointer)
      window.addEventListener('touchstart', onTouch, { passive: true })
    },
    stop(): string | null {
      if (!attached) return null
      attached = false
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('touchstart', onTouch)
      const log = entries.join(';')
      return log ? log.slice(0, maxChars) : null
    },
  }
}
