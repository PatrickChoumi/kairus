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
