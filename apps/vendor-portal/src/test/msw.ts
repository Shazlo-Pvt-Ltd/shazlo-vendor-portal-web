import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { resetApiClient } from '../api/instance'

export const BASE = 'https://api.test'

export const apiErrorResponse = (status: number, code: string, message = code, headers: Record<string, string> = {}) =>
  HttpResponse.json({ error: { code, message } }, { status, headers })

/** An MSW server for one test file. The session refresh answers 401 (nobody is signed in) unless a test says otherwise. */
export function useApiServer() {
  const server = setupServer()
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
  beforeEach(() => {
    vi.stubEnv('VITE_VENDOR_API_URL', BASE)
    resetApiClient()
    server.use(http.post(`${BASE}/v1/auth/refresh`, () => apiErrorResponse(401, 'unauthorized')))
  })
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  return server
}
