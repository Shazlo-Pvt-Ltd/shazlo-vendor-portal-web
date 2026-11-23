import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiClient, resetApiClient } from '../api/instance'
import { registerSessionHooks } from '../api/session'
import { createAdminSessionStore } from './adminSession'
import { AudienceNotAllowedError, UnknownAudienceError } from './store'
import { adminProfile, sessionBody } from './testing'

const BASE = 'https://identity.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  vi.stubEnv('VITE_IDENTITY_API_URL', BASE)
  resetApiClient()
})
afterEach(() => {
  server.resetHandlers()
  registerSessionHooks(undefined)
})
afterAll(() => server.close())

const unauthorized = () => HttpResponse.json({ error: { code: 'unauthorized', message: 'no' } }, { status: 401 })

function wire(onCleared = () => {}) {
  const store = createAdminSessionStore(onCleared)
  registerSessionHooks({ getAccessToken: store.getAccessToken, onUnauthorized: store.renew })
  return store
}

describe('the session against identity-api', () => {
  it('restores from the cookie alone, and /v1/me gets the new token', async () => {
    let meAuth: string | null = null
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody({ token: 'restored' }))),
      http.get(`${BASE}/v1/me`, ({ request }) => {
        meAuth = request.headers.get('Authorization')
        return HttpResponse.json(adminProfile({ display_name: 'From The Server', roles: ['reviewer'] }))
      }),
    )
    const store = wire()
    await store.start()
    expect(meAuth).toBe('Bearer restored')
    expect(store.getSnapshot()).toMatchObject({
      status: 'signedIn',
      roles: ['reviewer'],
      admin: { display_name: 'From The Server' },
    })
    store.close()
  })

  it('an access token alone cannot renew the session: a refresh without the cookie signs out', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody())),
      http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
    )
    const store = wire()
    await store.start()
    let sentToken: string | null = 'not asked'
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, ({ request }) => {
        sentToken = request.headers.get('Authorization')
        return unauthorized()
      }),
    )
    await store.renew()
    // The refresh call carries the access token like any call, but only the cookie can renew.
    expect(sentToken).toBe('Bearer token-1')
    expect(store.getSnapshot().status).toBe('signedOut')
    store.close()
  })

  it('does not hang when /v1/me answers 401 during a renewal (it must not wait for itself)', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody())),
      http.get(`${BASE}/v1/me`, unauthorized),
    )
    const store = wire()
    await store.start()
    expect(store.getSnapshot().status).toBe('signedOut')
    store.close()
  })

  it('retries a 409 refresh_conflict once and signs in', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json({ error: { code: 'refresh_conflict', message: 'again' } }, { status: 409 })
        }
        return HttpResponse.json(sessionBody({ token: 'second-try' }))
      }),
      http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
    )
    const store = wire()
    await store.start()
    expect(calls).toBe(2)
    expect(store.getAccessToken()).toBe('second-try')
    store.close()
  })

  it('ten simultaneous calls after expiry cause one refresh, and each is retried with the new token', async () => {
    let refreshes = 0
    const seen: Array<string | null> = []
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, async () => {
        refreshes += 1
        await delay(30)
        return HttpResponse.json(sessionBody({ token: `fresh-${refreshes}` }))
      }),
      http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
      http.get(`${BASE}/v1/roles`, ({ request }) => {
        const auth = request.headers.get('Authorization')
        seen.push(auth)
        return auth === 'Bearer fresh-2' ? HttpResponse.json([]) : unauthorized()
      }),
    )
    const store = wire()
    await store.start() // refresh #1: token fresh-1, which the API treats as expired
    const results = await Promise.all(Array.from({ length: 10 }, () => getApiClient().GET('/v1/roles')))
    expect(results).toHaveLength(10)
    expect(refreshes).toBe(2)
    expect(seen.filter((a) => a === 'Bearer fresh-2')).toHaveLength(10)
    store.close()
  })

  it('retries a 401 once and then reports it, so a rejected token cannot loop', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody())),
      http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
      http.get(`${BASE}/v1/roles`, () => {
        calls += 1
        return unauthorized()
      }),
    )
    const store = wire()
    await store.start()
    await expect(getApiClient().GET('/v1/roles')).rejects.toMatchObject({ status: 401 })
    expect(calls).toBe(2)
    store.close()
  })

  it('an admin with a no-roles token is held, and /v1/me is never called', async () => {
    let meCalls = 0
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody({ must_change_password: true }))),
      http.get(`${BASE}/v1/me`, () => {
        meCalls += 1
        return HttpResponse.json({ error: { code: 'password_change_required', message: 'no' } }, { status: 403 })
      }),
    )
    const store = wire()
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ status: 'passwordChangeRequired', roles: [] })
    expect(meCalls).toBe(0)
    store.close()
  })

  it('writes nothing to web storage through a whole session', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    server.use(
      http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody({ token: 'secret-token' }))),
      http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
      http.post(`${BASE}/v1/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    )
    const store = wire()
    await store.start()
    await store.logout()
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('secret-token')
    expect(document.cookie).not.toContain('secret-token')
    store.close()
  })

  describe('module tokens', () => {
    it('exchanges with the identity token and the audience in the body', async () => {
      let body: unknown
      let auth: string | null = null
      server.use(
        http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody({ token: 'identity' }))),
        http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
        http.post(`${BASE}/v1/auth/token`, async ({ request }) => {
          body = await request.json()
          auth = request.headers.get('Authorization')
          return HttpResponse.json({ access_token: 'for-module', token_type: 'Bearer', expires_in: 300, audience: 'vendor-api' })
        }),
      )
      const store = wire()
      await store.start()
      const token = await store.getModuleToken('vendor-api')
      expect(body).toEqual({ audience: 'vendor-api' })
      expect(auth).toBe('Bearer identity')
      expect(token.accessToken).toBe('for-module')
      store.close()
    })

    it('turns the two refusals into typed errors', async () => {
      server.use(
        http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json(sessionBody())),
        http.get(`${BASE}/v1/me`, () => HttpResponse.json(adminProfile())),
        http.post(`${BASE}/v1/auth/token`, async ({ request }) => {
          const { audience } = (await request.json()) as { audience: string }
          return audience === 'forbidden'
            ? HttpResponse.json({ error: { code: 'audience_not_allowed', message: 'no' } }, { status: 403 })
            : HttpResponse.json({ error: { code: 'unknown_audience', message: 'who' } }, { status: 400 })
        }),
      )
      const store = wire()
      await store.start()
      await expect(store.getModuleToken('forbidden')).rejects.toBeInstanceOf(AudienceNotAllowedError)
      await expect(store.getModuleToken('mystery')).rejects.toBeInstanceOf(UnknownAudienceError)
      store.close()
    })
  })
})
