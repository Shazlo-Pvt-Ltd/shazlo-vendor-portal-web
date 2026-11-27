import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// The tests run the shell against two stand-in modules (src/test/registry.json, served by
// src/test/modules.ts), never a real one: the shell must work for any module (ADR 0011).
const registry = readFileSync(new URL('./src/test/registry.json', import.meta.url), 'utf8')

export default defineConfig({
  plugins: [react()],
  define: { __SHELL_REGISTRY__: registry, __SHELL_REGISTRY_MODE__: JSON.stringify('development') },
  test: {
    name: 'shazlo-one',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Screens render the full MUI tree; give slow CI machines room.
    testTimeout: 15_000,
  },
})
