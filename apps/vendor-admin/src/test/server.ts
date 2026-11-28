import { createMockVendorApi, createVendorApiHandlers, type MockVendorApi } from '@shazlo/mock-vendor-api'
import { setupServer } from 'msw/node'

export let vendorDb: MockVendorApi = createMockVendorApi()
export const server = setupServer(...createVendorApiHandlers(() => vendorDb))

export function resetMockDb(now?: Date) {
  vendorDb = createMockVendorApi(now ? { now: () => now } : undefined)
  return vendorDb
}
