import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'shell-protocol',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Two real windows (an iframe inside the page) for the contract tests.
    environment: 'jsdom',
    restoreMocks: true,
    unstubGlobals: true,
  },
})
