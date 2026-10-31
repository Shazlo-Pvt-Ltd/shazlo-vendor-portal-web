import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    projects: [
      'packages/ui/vitest.config.ts',
      'apps/vendor-portal/vitest.config.ts',
      {
        esbuild: { jsx: 'automatic' },
        // The legacy application has its own lockfile and React 19.1 runtime.
        // Testing Library must use that same runtime rather than the UI workspace's copy.
        resolve: {
          alias: {
            react: fileURLToPath(new URL('./app/node_modules/react', import.meta.url)),
            'react-dom': fileURLToPath(new URL('./app/node_modules/react-dom', import.meta.url)),
          },
        },
        test: {
          name: 'legacy-app',
          root: fileURLToPath(new URL('./app', import.meta.url)),
          include: ['test/**/*.test.{js,jsx}'],
          environment: 'jsdom',
          setupFiles: ['./test/setup.js'],
          restoreMocks: true,
          unstubGlobals: true,
          unstubEnvs: true,
        },
      },
      {
        test: {
          name: 'legacy-backend',
          root: fileURLToPath(new URL('./backend', import.meta.url)),
          include: ['test/**/*.test.js'],
          environment: 'node',
          // A cold Windows MongoDB archive is large; database operations retain a 15s timeout.
          hookTimeout: 600_000,
          testTimeout: 15_000,
          restoreMocks: true,
        },
      },
      {
        test: {
          name: 'contracts',
          root: fileURLToPath(new URL('.', import.meta.url)),
          include: ['test/contracts/**/*.test.js'],
          environment: 'node',
        },
      },
    ],
    // Bound DOM rendering and MongoDB startup costs on developer machines and CI.
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['app/src/**/*.{js,jsx}', 'backend/**/*.js', 'packages/ui/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.*', 'backend/test/**', '**/node_modules/**'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
    },
  },
})
