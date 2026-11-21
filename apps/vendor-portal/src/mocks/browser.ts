import { setupWorker } from 'msw/browser'
import { createDb, type MockDb } from './db'
import { createHandlers } from './handlers'

/** Demo mode is on only when the build says `VITE_MOCK_API=on`; it is off by default. */
export function mockApiEnabled(env: { VITE_MOCK_API?: string } = import.meta.env): boolean {
  return env.VITE_MOCK_API === 'on'
}

/**
 * Starts the browser copy of the mock vendor-api (demo mode). The database lives in this page's
 * memory only, never in web storage: a reload starts again from the seed, and the emulated refresh
 * cookie goes with it, so the demo asks to sign in again.
 */
export async function startMockApi(): Promise<{ reset: () => void }> {
  let db: MockDb = createDb()
  const worker = setupWorker(...createHandlers(() => db))
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true, serviceWorker: { url: '/mockServiceWorker.js' } })
  return {
    reset: () => {
      db = createDb()
    },
  }
}
