import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  define: { __SHELL_ORIGIN__: JSON.stringify('http://localhost:5192'), __VENDOR_API_ORIGIN__: JSON.stringify('http://vendor-api.test') },
  test: {
    name: 'vendor-admin',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Screens render the full MUI tree; give slow CI machines room.
    testTimeout: 15_000,
  },
})
