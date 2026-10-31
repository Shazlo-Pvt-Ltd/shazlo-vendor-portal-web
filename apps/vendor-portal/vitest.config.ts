import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'vendor-portal',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
