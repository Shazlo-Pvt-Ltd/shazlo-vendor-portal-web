import { setupServer } from 'msw/node'
import { createDb, type MockDb } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'

// One mock API for every test file. Each test starts from fresh seed data (see resetMockDb).
export let mockDb: MockDb = createDb()
export const server = setupServer(...createHandlers(() => mockDb))

export function resetMockDb(seed?: Parameters<typeof createDb>[0]): MockDb {
  mockDb = createDb(seed)
  return mockDb
}
