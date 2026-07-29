import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The code under test reaches for localStorage, matchMedia and document.
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
})
