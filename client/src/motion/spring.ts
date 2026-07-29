/**
 * A spring integrator and a single shared frame loop.
 *
 * Every transition between states — opening a thread, answering a message,
 * summoning the Cursor — is a spring: interruptible, aware of its own velocity,
 * and never snapping. An easing curve cannot be interrupted mid-flight without
 * a visible discontinuity, which is why none drives a transition here.
 */

export type SpringConfig = {
  stiffness: number
  damping: number
  mass: number
}

/** Named characters, so motion stays consistent across the app. */
export const SPRING = {
  /** Structural moves: a panel taking its place. */
  solid: { stiffness: 210, damping: 26, mass: 1 },
  /** Quick, decisive feedback: a press, a toggle. */
  crisp: { stiffness: 420, damping: 34, mass: 1 },
  /** Long travel that should feel weighty: the morph between views. */
  glide: { stiffness: 150, damping: 22, mass: 1 },
  /** Gestures returning home. */
  snap: { stiffness: 600, damping: 40, mass: 1 },
} as const satisfies Record<string, SpringConfig>

const REST_DISTANCE = 0.0005
const REST_VELOCITY = 0.005
const SUBSTEP = 1 / 240

type Frame = (dt: number) => void

class Loop {
  private subscribers = new Set<Frame>()
  private raf = 0
  private last = 0

  add(fn: Frame): () => void {
    this.subscribers.add(fn)
    this.start()
    return () => {
      this.subscribers.delete(fn)
      if (this.subscribers.size === 0) this.stop()
    }
  }

  private start(): void {
    if (this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private tick = (now: number): void => {
    // A backgrounded tab can hand us a huge delta; clamping keeps springs sane.
    const dt = Math.min((now - this.last) / 1000, 1 / 15)
    this.last = now
    for (const fn of this.subscribers) fn(dt)
    this.raf = this.subscribers.size ? requestAnimationFrame(this.tick) : 0
  }
}

const loop = new Loop()

export type Spring = {
  /** Move towards a new target, carrying current velocity. */
  to(target: number): void
  /** Teleport: no motion, no velocity. */
  set(value: number): void
  get(): number
  velocity(): number
  /** Stop integrating and release the frame subscription. */
  dispose(): void
}

export function createSpring(
  initial: number,
  config: SpringConfig,
  onFrame: (value: number) => void,
): Spring {
  let value = initial
  let target = initial
  let velocity = 0
  let unsubscribe: (() => void) | null = null

  const settle = () => {
    value = target
    velocity = 0
    onFrame(value)
    unsubscribe?.()
    unsubscribe = null
  }

  const step = (dt: number) => {
    // Semi-implicit Euler at a fixed substep: stable at any frame rate.
    let remaining = dt
    while (remaining > 0) {
      const h = Math.min(SUBSTEP, remaining)
      remaining -= h
      const force = -config.stiffness * (value - target) - config.damping * velocity
      velocity += (force / config.mass) * h
      value += velocity * h
    }

    const span = Math.max(Math.abs(target), 1)
    if (Math.abs(target - value) / span < REST_DISTANCE && Math.abs(velocity) / span < REST_VELOCITY) {
      settle()
      return
    }
    onFrame(value)
  }

  const wake = () => {
    if (!unsubscribe) unsubscribe = loop.add(step)
  }

  return {
    to(next) {
      if (next === target) return
      target = next
      if (prefersReducedMotion()) {
        settle()
        return
      }
      wake()
    },
    set(next) {
      target = next
      settle()
    },
    get: () => value,
    velocity: () => velocity,
    dispose() {
      unsubscribe?.()
      unsubscribe = null
    },
  }
}

let reducedMotion: MediaQueryList | null = null

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)')
  return reducedMotion.matches
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
