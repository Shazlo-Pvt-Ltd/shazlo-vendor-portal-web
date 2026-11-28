import { setupServer } from 'msw/node'
import { createIdentityDb, createIdentityHandlers, type IdentityDb } from '../mocks/identity'
import { fakeModules } from './modules'

// identity-api and the two stand-in modules (their manifests and summaries) for every test; each
// render starts from fresh seed data. A test changes a module's answers with server.use(...).
export let identityDb: IdentityDb = createIdentityDb()
export const server = setupServer(...createIdentityHandlers(() => identityDb), ...fakeModules.flatMap((m) => m.handlers()))

export function resetMocks() {
  identityDb = createIdentityDb()
  return { identityDb }
}
