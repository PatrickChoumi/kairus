import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// A component left mounted between cases would answer the next one's queries.
afterEach(cleanup)

/**
 * jsdom does not implement matchMedia, which the theme and the motion system
 * both consult. This fills the gap in the environment rather than making the
 * application defensive about a browser API that always exists in a browser.
 */
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList
}


/**
 * The motion system drives styles from a shared animation loop. jsdom has no
 * frames worth waiting for, so springs are allowed to settle immediately —
 * a test asserting on a value halfway through a spring would be asserting on
 * a frame rate.
 */
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    window.setTimeout(() => cb(performance.now()), 0) as unknown as number
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id)
}

/** Neither exists in jsdom, and both are reached for by the composer. */
if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => undefined
}
