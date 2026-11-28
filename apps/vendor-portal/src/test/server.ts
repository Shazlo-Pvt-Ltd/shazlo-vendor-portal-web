import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { forgetAssets } from '../api/adapters/assets'
import { resetApiClient } from '../api/instance'
import { registerSessionHooks } from '../api/session'
import { createDb, type MockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

/** The API origin tests point the client at (VITE_VENDOR_API_URL). */
export const MOCK_API = 'https://api.test'

// The mock vendor-api (src/mocks) for the test files that call setupMockApi(). It is not started for
// every file: main's tests start their own MSW server, and two servers would both answer.
export let mockDb: MockDb = createDb()
export const server = setupServer(...createHandlers(() => mockDb))

export function resetMockDb(seed?: Parameters<typeof createDb>[0]): MockDb {
  mockDb = createDb(seed)
  return mockDb
}

/**
 * Starts the mock vendor-api for this test file. Each test gets a fresh database (Kalki Studio's
 * seed), the API client pointed at {@link MOCK_API}, no session hooks and no remembered images.
 */
export function setupMockApi(options: { now?: () => Date } = {}) {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
  beforeEach(() => {
    resetMockDb(options.now ? { now: options.now } : undefined)
    vi.stubEnv('VITE_VENDOR_API_URL', MOCK_API)
    resetApiClient()
    forgetAssets()
  })
  afterEach(() => {
    server.resetHandlers()
    registerSessionHooks(undefined)
  })
  afterAll(() => server.close())
  return { server, db: () => mockDb }
}
