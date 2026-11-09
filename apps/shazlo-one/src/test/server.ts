import { createMockVendorApi, createVendorApiHandlers, type MockVendorApi } from '@shazlo/mock-vendor-api'
import { setupServer } from 'msw/node'
import { createIdentityDb, createIdentityHandlers, type IdentityDb } from '../mocks/identity'

// identity-api and vendor-api mocks for every test; each render starts from fresh seed data.
export let identityDb: IdentityDb = createIdentityDb()
export let vendorDb: MockVendorApi = createMockVendorApi()
export const server = setupServer(...createIdentityHandlers(() => identityDb), ...createVendorApiHandlers(() => vendorDb))

export function resetMocks() {
  identityDb = createIdentityDb()
  vendorDb = createMockVendorApi()
  return { identityDb, vendorDb }
}
