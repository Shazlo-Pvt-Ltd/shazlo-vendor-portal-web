import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'vendor-portal',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Form tests drive MUI through a jsdom DOM; a busy CI runner with coverage on needs more than 5 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
