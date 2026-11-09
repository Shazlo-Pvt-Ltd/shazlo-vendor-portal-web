import { mockApi, type VendorApi } from './mock'

// Until vendor-api ships (ROADMAP Phases 2–3) every call goes to the in-memory mock.
// VITE_VENDOR_API_URL is read here when the HTTP client replaces it, one method at a time.
export const api: VendorApi = mockApi
export * from './types'
