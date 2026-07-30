/*
 * Rate limiting.
 *
 * Token buckets: a burst is allowed, a sustained flood is not. Buckets refill
 * lazily — there is no timer per key — and a sweep drops the ones that have
 * refilled completely, so memory stays proportional to *active* callers rather
 * than to everyone who has ever knocked.
 */

type Bucket = { tokens: number; stamp: number }

export class Limiter {
  private buckets = new Map<string, Bucket>()

  constructor(
    /** How much can be spent at once. */
    readonly capacity: number,
    /** How fast it comes back. */
    readonly perMinute: number,
  ) {
    registry.add(this)
  }

  private refill(bucket: Bucket, now: number): void {
    const minutes = (now - bucket.stamp) / 60_000
    bucket.tokens = Math.min(this.capacity, bucket.tokens + minutes * this.perMinute)
    bucket.stamp = now
  }

  /** Returns 0 when the call is allowed, else the seconds to wait. */
  take(key: string, cost = 1): number {
    const now = Date.now()
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, stamp: now }
    this.buckets.set(key, bucket)
    this.refill(bucket, now)

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return 0
    }
    return Math.max(1, Math.ceil(((cost - bucket.tokens) / this.perMinute) * 60))
  }

  /** Forgives a key — used when an attempt turns out to be legitimate. */
  clear(key: string): void {
    this.buckets.delete(key)
  }

  /** Drops buckets that have refilled: keeping them would say nothing. */
  sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      const minutes = (now - bucket.stamp) / 60_000
      if (bucket.tokens + minutes * this.perMinute >= this.capacity) this.buckets.delete(key)
    }
  }

  /** Test seam: how many keys are currently being tracked. */
  get size(): number {
    return this.buckets.size
  }
}

const registry = new Set<Limiter>()

const sweeper = setInterval(() => {
  const now = Date.now()
  for (const limiter of registry) limiter.sweep(now)
}, 60_000)
sweeper.unref?.()

/**
 * Every limit in one place, so the policy can be read without hunting through
 * handlers. Each is named for what it protects, not for where it is applied.
 */
export const limits = {
  /** Blanket ceiling per address — the last line, whatever the endpoint. */
  anything: new Limiter(600, 600),

  /** Guessing passphrases from one machine. */
  signInFromAddress: new Limiter(20, 20 / 15),
  /**
   * Guessing the passphrase of one account, from anywhere. This is the limit
   * a botnet cannot walk around by rotating addresses.
   */
  signInToHandle: new Limiter(6, 6 / 15),

  /** Minting accounts. */
  signUp: new Limiter(5, 5 / 60),
  /** Trying recovery phrases. */
  recover: new Limiter(5, 5 / 60),

  /** Saying things: a burst of 25, then one a second. */
  write: new Limiter(25, 60),
  /** Opening conversations with new people. */
  open: new Limiter(30, 30 / 60),
  /** Searching — every keystroke in the Cursor reaches here. */
  look: new Limiter(30, 120),
  /** Sending files: a handful at once, then a steady trickle. */
  upload: new Limiter(10, 20),
  /**
   * Placing calls. Only the ring is counted — the candidates that follow are
   * many and arrive in a burst by nature, and the frame ceiling already covers
   * them. Ringing someone repeatedly is the thing worth slowing down.
   */
  ring: new Limiter(6, 6 / 5),
} as const

/** Test seam: forget everything, so one case cannot starve the next. */
export function resetLimits(): void {
  for (const limiter of registry) limiter.sweep(Date.now() + 86_400_000)
}
