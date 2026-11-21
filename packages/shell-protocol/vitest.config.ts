import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'shell-protocol',
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
})
