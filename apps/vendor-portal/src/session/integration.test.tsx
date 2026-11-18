import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiClient, resetApiClient } from '../api/instance'
import { registerSessionHooks } from '../api/session'
import { createVendorSessionStore } from './vendorSession'
import { sessionBody } from './testing'

const BASE = 'https://api.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  vi.stubEnv('VITE_VENDOR_API_URL', BASE)
  resetApiClient()
})
afterEach(() => {
  server.resetHandlers()
  registerSessionHooks(undefined)
})
afterAll(() => server.close())

function wire(onCleared = () => {}) {
  const store = createVendorSessionStore(onCleared)
  registerSessionHooks({ getAccessToken: store.getAccessToken, onUnauthorized: store.renew, onApiError: () => {} })
  return store
}

describe('the session against the API', () => {
  it('restores the session on load from the cookie alone', async () => {
    server.use(http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody({ token: 'restored' }))))
    const store = wire()
    await store.start()
    expect(store.getSnapshot().status).toBe('signedIn')
    expect(store.getAccessToken()).toBe('restored')
    store.close()
  })

  it('ten simultaneous requests after expiry cause exactly one refresh, and each is retried with the new token', async () => {
    let refreshes = 0
    const seen: Array<string | null> = []
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, async () => {
        refreshes += 1
        await delay(30)
        return HttpResponse.json(sessionBody({ token: `fresh-${refreshes}` }))
      }),
      http.get(`${BASE}/v1/vendor/me`, ({ request }) => {
        const auth = request.headers.get('Authorization')
        seen.push(auth)
        if (auth !== 'Bearer fresh-2') {
          return HttpResponse.json({ error: { code: 'unauthorized', message: 'expired' } }, { status: 401 })
        }
        return HttpResponse.json({ user: {}, vendor: {} })
      }),
    )
    const store = wire()
    await store.start() // refresh #1: token fresh-1, which the API treats as expired
    expect(refreshes).toBe(1)
    const results = await Promise.all(Array.from({ length: 10 }, () => getApiClient().GET('/v1/vendor/me')))
    expect(results).toHaveLength(10)
    expect(refreshes).toBe(2) // exactly one more
    expect(seen.filter((a) => a === 'Bearer fresh-2')).toHaveLength(10)
    store.close()
  })

  it('retries a 401 once and then reports it, so a rejected token cannot loop', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody())),
      http.get(`${BASE}/v1/vendor/me`, () => {
        calls += 1
        return HttpResponse.json({ error: { code: 'unauthorized', message: 'no' } }, { status: 401 })
      }),
    )
    const store = wire()
    await store.start()
    await expect(getApiClient().GET('/v1/vendor/me')).rejects.toMatchObject({ status: 401 })
    expect(calls).toBe(2)
    store.close()
  })

  it('a 401 on refresh ends the session and clears the caches', async () => {
    let signedInOnce = false
    const onCleared = vi.fn()
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => {
        if (!signedInOnce) {
          signedInOnce = true
          return HttpResponse.json(sessionBody())
        }
        return HttpResponse.json({ error: { code: 'unauthorized', message: 'gone' } }, { status: 401 })
      }),
      http.get(`${BASE}/v1/vendor/me`, () =>
        HttpResponse.json({ error: { code: 'unauthorized', message: 'expired' } }, { status: 401 }),
      ),
    )
    const store = wire(onCleared)
    await store.start()
    await expect(getApiClient().GET('/v1/vendor/me')).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
    expect(onCleared).toHaveBeenCalled()
    store.close()
  })

  it('retries a 409 refresh_conflict and then signs in', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json({ error: { code: 'refresh_conflict', message: 'retry' } }, { status: 409 })
        }
        return HttpResponse.json(sessionBody({ token: 'after-409' }))
      }),
    )
    const store = wire()
    await store.start()
    expect(store.getAccessToken()).toBe('after-409')
    store.close()
  })

  it('logout posts to the server and leaves no token', async () => {
    let logouts = 0
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody())),
      http.post(`${BASE}/v1/auth/logout`, () => {
        logouts += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const store = wire()
    await store.start()
    await store.logout()
    expect(logouts).toBe(1)
    expect(store.getAccessToken()).toBeNull()
    store.close()
  })
})
