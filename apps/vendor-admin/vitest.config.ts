import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Same compile-time constant vite.config.ts defines; tests run unframed, so it is never used to post.
  define: { __SHELL_ORIGIN__: JSON.stringify('http://localhost:5174') },
  test: {
    name: 'vendor-admin',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The vendor table renders 36 rows; jsdom is slow with it on a busy machine.
    testTimeout: 20_000,
  },
})
