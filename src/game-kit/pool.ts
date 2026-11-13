// game-kit — generic object pool.
//
// Allocation is the #1 cause of GC stutter in canvas games. Pool anything with a
// hot create/discard cycle (particles, bullets, corpses). `reset` must fully
// reinitialize an item so acquire() always returns a clean object.

export class Pool<T> {
  private free: T[] = []
  private liveCount = 0

  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(factory())
  }

  /** Get a clean item (from the pool or freshly allocated). */
  acquire(): T {
    const item = this.free.pop() ?? this.factory()
    this.reset(item)
    this.liveCount++
    return item
  }

  /** Return an item to the pool. Double-release is a no-op guard: callers
   *  should avoid it, but the pool must never corrupt itself if it happens. */
  release(item: T): void {
    const idx = this.free.indexOf(item)
    if (idx !== -1) return // already released
    if (this.liveCount > 0) this.liveCount--
    this.free.push(item)
  }

  get live(): number {
    return this.liveCount
  }

  get pooled(): number {
    return this.free.length
  }

  /** Drop pooled references (e.g. on game destroy) so GC can collect. */
  clear(): void {
    this.free.length = 0
    this.liveCount = 0
  }
}
