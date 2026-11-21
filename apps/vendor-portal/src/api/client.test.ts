import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { ApiError, createApi, type TokenStore } from './client'

const BASE = 'http://api.test'

function memoryTokens(initial: string | null): TokenStore & { current: string | null; sets: (string | null)[] } {
  const store = {
    current: initial,
    sets: [] as (string | null)[],
    get: () => store.current,
    set: (t: string | null) => {
      store.current = t
      store.sets.push(t)
    },
  }
  return store
}

const expired = () => HttpResponse.json({ message: 'Expired', extra: { code: 'unauthenticated' } }, { status: 401 })
const session = (access: string) => HttpResponse.json({ access_token: access, token_type: 'Bearer', expires_in: 900 })
// /me answers only to the token named, as if every older one had expired.
const meFor = (access: string) =>
  http.get(`${BASE}/api/v1/vendor/me`, ({ request }) => (request.headers.get('authorization') === `Bearer ${access}` ? HttpResponse.json({ ok: true }) : expired()))

describe('createApi', () => {
  it('sends the access token, a request id and the cookie', async () => {
    const seen = vi.fn()
    server.use(
      http.get(`${BASE}/api/v1/vendor/summary`, ({ request }) => {
        seen(request.headers.get('authorization'), request.headers.get('x-request-id'), request.credentials)
        return HttpResponse.json({ products: { all: 0, approved: 0, pending_review: 0, rejected: 0, draft: 0, archived: 0 }, reviews_waiting: 0, oldest_waiting_hours: null, sent_back: 0 })
      }),
    )
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens('a1') })
    await api.call((c) => c.GET('/api/v1/vendor/summary'))
    expect(seen).toHaveBeenCalledWith('Bearer a1', expect.stringMatching(/^[0-9a-f-]{36}$/), 'include')
  })

  it('refreshes once on 401 with the cookie alone and retries the request', async () => {
    const refreshes = vi.fn()
    server.use(
      meFor('a2'),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, async ({ request }) => {
        refreshes(request.headers.get('authorization') ?? '', await request.text(), request.credentials)
        return session('a2')
      }),
    )
    const store = memoryTokens('a1')
    const api = createApi({ baseUrl: BASE, tokens: store })
    const [first, second] = await Promise.all([api.call((c) => c.GET('/api/v1/vendor/me')), api.call((c) => c.GET('/api/v1/vendor/me'))])
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    // One refresh for both: the cookie rotates on every use. No body, no stale bearer token.
    expect(refreshes).toHaveBeenCalledOnce()
    expect(refreshes).toHaveBeenCalledWith(expect.not.stringContaining('Bearer'), '', 'include')
    expect(store.current).toBe('a2')
  })

  it('retries a refresh conflict once, since another tab already rotated the cookie', async () => {
    let refreshCalls = 0
    server.use(
      meFor('a2'),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, () => {
        refreshCalls += 1
        return refreshCalls === 1 ? HttpResponse.json({ message: 'Try again', extra: { code: 'refresh_conflict' } }, { status: 409 }) : session('a2')
      }),
    )
    const store = memoryTokens('a1')
    const api = createApi({ baseUrl: BASE, tokens: store, conflictWaitMs: 0 })
    expect(await api.call((c) => c.GET('/api/v1/vendor/me'))).toEqual({ ok: true })
    expect(refreshCalls).toBe(2)
    expect(store.current).toBe('a2')
  })

  it('signs out when the refresh cookie is rejected', async () => {
    server.use(
      http.get(`${BASE}/api/v1/vendor/me`, expired),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, () => HttpResponse.json({ message: 'Revoked', extra: { code: 'unauthenticated' } }, { status: 401 })),
    )
    const store = memoryTokens('a1')
    const onSignedOut = vi.fn()
    const api = createApi({ baseUrl: BASE, tokens: store, onSignedOut })
    await expect(api.call((c) => c.GET('/api/v1/vendor/me'))).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(store.current).toBeNull()
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it('keeps the session when the refresh cannot reach the server', async () => {
    server.use(http.get(`${BASE}/api/v1/vendor/me`, expired), http.post(`${BASE}/api/v1/vendor/auth/refresh`, () => HttpResponse.error()))
    const store = memoryTokens('a1')
    const onSignedOut = vi.fn()
    const api = createApi({ baseUrl: BASE, tokens: store, onSignedOut })
    await expect(api.call((c) => c.GET('/api/v1/vendor/me'))).rejects.toMatchObject({ status: 0, code: 'network_error' })
    expect(store.current).toBe('a1')
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('reports a failing refresh as that failure, not as a signed-out seller', async () => {
    server.use(
      http.get(`${BASE}/api/v1/vendor/me`, expired),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, () => HttpResponse.json({ message: 'Too many attempts', extra: { code: 'rate_limited' } }, { status: 429 })),
    )
    const store = memoryTokens('a1')
    const api = createApi({ baseUrl: BASE, tokens: store })
    await expect(api.call((c) => c.GET('/api/v1/vendor/me'))).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
    expect(store.current).toBe('a1')
  })

  it('does not let a slow refresh replace a session that started meanwhile', async () => {
    let answer: (() => void) | undefined
    server.use(
      meFor('invite-session'),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, async () => {
        await new Promise<void>((resolve) => (answer = resolve))
        return session('old-session')
      }),
    )
    const store = memoryTokens('a1')
    const api = createApi({ baseUrl: BASE, tokens: store })
    const pending = api.call((c) => c.GET('/api/v1/vendor/me'))
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    store.set('invite-session') // an accepted invite signs someone in while the refresh is out
    answer!()
    expect(await pending).toEqual({ ok: true })
    expect(store.current).toBe('invite-session')
  })

  describe('refresh() after a page load', () => {
    it('restores the session from the cookie', async () => {
      server.use(http.post(`${BASE}/api/v1/vendor/auth/refresh`, () => session('a9')))
      const store = memoryTokens(null)
      const api = createApi({ baseUrl: BASE, tokens: store })
      expect(await api.refresh()).toBe(true)
      expect(store.current).toBe('a9')
    })

    it('settles as signed out without a cookie, or when the server cannot be reached', async () => {
      for (const answer of [() => HttpResponse.json({ message: 'No session', extra: { code: 'unauthenticated' } }, { status: 401 }), () => HttpResponse.error()]) {
        server.use(http.post(`${BASE}/api/v1/vendor/auth/refresh`, answer))
        const store = memoryTokens(null)
        const onSignedOut = vi.fn()
        const api = createApi({ baseUrl: BASE, tokens: store, onSignedOut })
        expect(await api.refresh()).toBe(false)
        // set(null) moves the session store from loading to signed out.
        expect(store.sets).toEqual([null])
        expect(onSignedOut).not.toHaveBeenCalled()
      }
    })

    it('shares one request between parallel callers', async () => {
      const refresh = vi.fn(() => session('a9'))
      server.use(http.post(`${BASE}/api/v1/vendor/auth/refresh`, refresh))
      const api = createApi({ baseUrl: BASE, tokens: memoryTokens(null) })
      expect(await Promise.all([api.refresh(), api.refresh()])).toEqual([true, true])
      expect(refresh).toHaveBeenCalledOnce()
    })
  })

  it('turns the error envelope into an ApiError with field messages', async () => {
    server.use(
      http.post(`${BASE}/api/v1/vendor/products`, () =>
        HttpResponse.json({ message: 'Check the highlighted fields', extra: { code: 'validation_error', fields: { title: 'Add a title' } } }, { status: 422 }),
      ),
    )
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens('a1') })
    const error = await api.call((c) => c.POST('/api/v1/vendor/products', { body: {} })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'validation_error', message: 'Check the highlighted fields', fields: { title: 'Add a title' } })
  })

  it('reports a network failure as a retryable ApiError', async () => {
    server.use(http.get(`${BASE}/api/v1/vendor/summary`, () => HttpResponse.error()))
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens('a1') })
    await expect(api.call((c) => c.GET('/api/v1/vendor/summary'))).rejects.toMatchObject({ code: 'network_error', status: 0 })
  })

  it('does not try to refresh when nobody is signed in', async () => {
    const refresh = vi.fn()
    server.use(
      http.post(`${BASE}/api/v1/vendor/auth/login`, () => HttpResponse.json({ message: 'Wrong email or password', extra: { code: 'unauthenticated' } }, { status: 401 })),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, refresh),
    )
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(null) })
    await expect(api.call((c) => c.POST('/api/v1/vendor/auth/login', { body: { identifier: 'a', password: 'b' } }))).rejects.toMatchObject({ status: 401 })
    expect(refresh).not.toHaveBeenCalled()
  })
})
