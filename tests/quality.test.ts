// Roadmap slice 2 tests (ADR-029): lite mode (QualityMonitor) + PWA assets.
// QualityMonitor is driven by a fake rAF clock — no browser needed.

import { describe, expect, it } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// fake rAF harness ----------------------------------------------------------------
//
// The stub stores the LATEST callback (tick re-registers itself each frame),
// so the driver pulls a fresh handle every iteration — never a stale local.

type FrameCb = (ts: number) => void

interface RafStub {
  /** drive n frames at the given fps; returns monotonic ts end */
  drive(frames: number, fps: number): number
  restore(): void
}

function stubRaf(): RafStub {
  const origRaf = globalThis.requestAnimationFrame
  const origCancel = globalThis.cancelAnimationFrame
  let cb: FrameCb | null = null
  let t = 0
  globalThis.requestAnimationFrame = ((next: FrameCb) => {
    cb = next
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {
    cb = null
  }) as typeof cancelAnimationFrame
  return {
    drive(frames: number, fps: number): number {
      const step = 1000 / fps
      for (let i = 0; i < frames; i++) {
        t += step
        const current = cb
        cb = null
        current?.(t)
      }
      return t
    },
    restore(): void {
      globalThis.requestAnimationFrame = origRaf
      globalThis.cancelAnimationFrame = origCancel
    },
  }
}

describe('lite mode — QualityMonitor', () => {
  it('full-fps device never degrades (tier stays 0)', async () => {
    const { QualityMonitor } = await import('../src/game-kit/quality')
    const raf = stubRaf()
    const tiers: number[] = []
    const mon = new QualityMonitor((tier) => tiers.push(tier), 'auto')
    mon.start()
    expect(tiers).toEqual([0]) // initial apply

    raf.drive(400, 60) // ~6.7s of solid 60fps
    expect(mon.state.tier).toBe(0)
    expect(mon.state.mode).toBe('auto')
    expect(mon.state.auto).toBe(false) // no degrade fired
    mon.destroy()
    raf.restore()
  })

  it('weak device degrades: sustained <50fps walks the tiers down to ULTRA', async () => {
    const { QualityMonitor } = await import('../src/game-kit/quality')
    const raf = stubRaf()
    const tiers: number[] = []
    const mon = new QualityMonitor((tier) => tiers.push(tier), 'auto')
    mon.start()
    raf.drive(300, 30) // 150+ bad frames → tier 1 fires…
    raf.drive(1400, 30) // …cooldown (8s) passes with continued bad fps → tier 2
    expect(mon.state.tier).toBe(2)
    expect(tiers.filter((x) => x === 1).length).toBe(1)
    expect(tiers.filter((x) => x === 2).length).toBe(1)
    expect(mon.state.auto).toBe(true) // auto-degrade fired
    mon.destroy()
    raf.restore()
  })

  it('mode cycle: auto → lite → off → auto, lite pins tier 1', async () => {
    const { QualityMonitor } = await import('../src/game-kit/quality')
    const raf = stubRaf()
    const tiers: number[] = []
    const mon = new QualityMonitor((tier) => tiers.push(tier), 'auto')
    mon.start()
    expect(mon.cycleMode()).toBe('lite')
    expect(mon.state.tier).toBe(1) // pinned lite
    expect(mon.cycleMode()).toBe('off')
    expect(mon.state.tier).toBe(0) // pinned full
    expect(mon.cycleMode()).toBe('auto')
    expect(mon.state.tier).toBe(0) // watching again
    mon.destroy()
    raf.restore()
  })

  it('degrade cooldown: one bad burst does not cascade tiers instantly', async () => {
    const { QualityMonitor } = await import('../src/game-kit/quality')
    const raf = stubRaf()
    const mon = new QualityMonitor(() => {}, 'auto')
    mon.start()
    raf.drive(160, 30) // 150-sample verdict → tier 1
    expect(mon.state.tier).toBe(1)
    raf.drive(160, 30) // only ~5.3s since degrade — inside the 8s cooldown
    expect(mon.state.tier).toBe(1)
    mon.destroy()
    raf.restore()
  })

  it('dpr caps: full 2, lite 1.5, ultra 1 (never above full)', async () => {
    const { dprCapFor } = await import('../src/game-kit/quality')
    expect(dprCapFor(0)).toBe(2)
    expect(dprCapFor(1)).toBe(1.5)
    expect(dprCapFor(2)).toBe(1)
  })
})

// ---------------------------------------------------------------- PWA assets

describe('PWA assets (slice 2)', () => {
  const pub = join(process.cwd(), 'public')

  it('manifest.json is valid JSON with the required install fields', () => {
    const raw = readFileSync(join(pub, 'manifest.json'), 'utf8')
    const m = JSON.parse(raw) as Record<string, unknown>
    expect(m.name).toContain('BRUTAL')
    expect(m.start_url).toBe('/?src=pwa')
    expect(m.display).toBe('standalone')
    const icons = m.icons as { src: string; sizes: string; type: string; purpose: string }[]
    expect(icons.length).toBe(3)
    for (const i of icons) {
      expect(existsSync(join(pub, i.src.replace(/^\//, '')))).toBe(true)
      expect(i.type).toBe('image/png')
    }
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('service worker: precaches the shell, never caches the API', () => {
    const sw = readFileSync(join(pub, 'sw.js'), 'utf8')
    // shell list includes the offline fallback + manifest
    expect(sw).toContain("'/offline.html'")
    expect(sw).toContain("'/manifest.json'")
    // API guard before any caching path
    expect(sw).toContain("url.pathname.startsWith('/api/')")
    // POSTs bypass the SW entirely
    expect(sw).toContain("req.method !== 'GET'")
    // cache versioning so future deploys invalidate old shells
    expect(sw).toContain("brutal-v1")
  })

  it('offline fallback page exists and explains UNRANKED offline runs', () => {
    const html = readFileSync(join(pub, 'offline.html'), 'utf8')
    expect(html).toContain('UNRANKED')
    expect(html).toContain('SIGNAL LOST')
  })
})
