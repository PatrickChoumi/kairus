import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The code under test reaches for localStorage, matchMedia and document.
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // .tsx too, now that the components themselves are under test.
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
