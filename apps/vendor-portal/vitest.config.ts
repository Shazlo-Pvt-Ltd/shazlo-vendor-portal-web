import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'vendor-portal',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
