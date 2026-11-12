// BRUTAL // ARENA — tiny WebAudio synth engine (no audio assets needed)

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lastAt: Record<string, number> = {}
  muted = false

  /** Must be called from a user gesture to unlock audio. */
  unlock() {
    if (typeof window === 'undefined') return
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private throttled(key: string, ms: number): boolean {
    const now = performance.now()
    if ((this.lastAt[key] ?? -1e9) + ms > now) return true
    this.lastAt[key] = now
    return false
  }

  private tone(
    freq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const bq = this.ctx.createBiquadFilter()
    bq.type = filter
    bq.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(bq)
    bq.connect(g)
    g.connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  shoot() {
    if (this.throttled('shoot', 45)) return
    this.tone(760, 180, 0.08, 'square', 0.06)
  }

  hit() {
    if (this.throttled('hit', 40)) return
    this.noise(0.05, 0.09, 'highpass', 2200)
  }

  kill() {
    if (this.throttled('kill', 60)) return
    this.tone(1400, 320, 0.09, 'square', 0.08)
    this.noise(0.08, 0.1, 'lowpass', 1400)
  }

  explode(big: boolean) {
    this.noise(big ? 0.7 : 0.3, big ? 0.4 : 0.22, 'lowpass', big ? 500 : 900)
    this.tone(big ? 130 : 170, 35, big ? 0.5 : 0.25, 'sine', big ? 0.35 : 0.2)
  }

  hurt() {
    this.tone(200, 70, 0.28, 'sawtooth', 0.25)
    this.noise(0.2, 0.18, 'lowpass', 700)
  }

  dash() {
    this.noise(0.14, 0.13, 'highpass', 1400)
    this.tone(280, 640, 0.12, 'sine', 0.08)
  }

  pickup() {
    this.tone(660, 660, 0.07, 'square', 0.12)
    this.tone(990, 990, 0.09, 'square', 0.12, 0.07)
  }

  waveStart() {
    this.tone(330, 330, 0.09, 'square', 0.12)
    this.tone(440, 440, 0.09, 'square', 0.12, 0.09)
    this.tone(550, 550, 0.14, 'square', 0.12, 0.18)
  }

  bossStart() {
    this.tone(55, 55, 1.1, 'sawtooth', 0.3)
    this.noise(1.0, 0.2, 'lowpass', 300)
    this.tone(82, 82, 1.1, 'sawtooth', 0.18, 0.05)
  }

  upgrade() {
    this.tone(520, 520, 0.08, 'square', 0.1)
    this.tone(780, 780, 0.12, 'square', 0.1, 0.08)
  }

  ui() {
    if (this.throttled('ui', 60)) return
    this.tone(500, 500, 0.05, 'square', 0.07)
  }

  overdrive() {
    this.tone(140, 980, 0.55, 'sawtooth', 0.22)
    this.tone(70, 490, 0.55, 'square', 0.12, 0.03)
    this.noise(0.45, 0.18, 'bandpass', 700)
  }

  streak() {
    this.tone(880, 880, 0.08, 'square', 0.14)
    this.tone(1320, 1320, 0.16, 'square', 0.14, 0.08)
  }

  heartbeat() {
    this.tone(72, 40, 0.16, 'sine', 0.3)
    this.tone(58, 34, 0.13, 'sine', 0.2, 0.17)
  }
}
