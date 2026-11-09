import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { ApiError, createApi, type Tokens, type TokenStore } from './client'

const BASE = 'http://api.test'

function memoryTokens(initial: Tokens | null): TokenStore & { current: Tokens | null } {
  const store = {
    current: initial,
    get: () => store.current,
    set: (t: Tokens | null) => {
      store.current = t
    },
  }
  return store
}

const tokens = (access: string, refresh = 'r1'): Tokens => ({ access_token: access, refresh_token: refresh })

describe('createApi', () => {
  it('sends the access token and a request id', async () => {
    const seen = vi.fn()
    server.use(
      http.get(`${BASE}/api/v1/vendor/summary`, ({ request }) => {
        seen(request.headers.get('authorization'), request.headers.get('x-request-id'))
        return HttpResponse.json({ products: { all: 0, approved: 0, pending_review: 0, rejected: 0, draft: 0, archived: 0 }, reviews_waiting: 0, oldest_waiting_hours: null, sent_back: 0 })
      }),
    )
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(tokens('a1')) })
    await api.call((c) => c.GET('/api/v1/vendor/summary'))
    expect(seen).toHaveBeenCalledWith('Bearer a1', expect.stringMatching(/^[0-9a-f-]{36}$/))
  })

  it('refreshes once on 401 and retries the request', async () => {
    let refreshCalls = 0
    server.use(
      http.get(`${BASE}/api/v1/vendor/me`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer a2'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ message: 'Expired', extra: { code: 'unauthenticated' } }, { status: 401 }),
      ),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, async ({ request }) => {
        refreshCalls += 1
        const body = (await request.json()) as { refresh_token: string }
        expect(body.refresh_token).toBe('r1')
        return HttpResponse.json({ access_token: 'a2', refresh_token: 'r2', expires_in: 900 })
      }),
    )
    const store = memoryTokens(tokens('a1'))
    const api = createApi({ baseUrl: BASE, tokens: store })
    const [first, second] = await Promise.all([
      api.call((c) => c.GET('/api/v1/vendor/me')),
      api.call((c) => c.GET('/api/v1/vendor/me')),
    ])
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
    expect(store.current).toEqual({ access_token: 'a2', refresh_token: 'r2' })
  })

  it('signs out when the refresh token is rejected', async () => {
    server.use(
      http.get(`${BASE}/api/v1/vendor/me`, () => HttpResponse.json({ message: 'Expired', extra: { code: 'unauthenticated' } }, { status: 401 })),
      http.post(`${BASE}/api/v1/vendor/auth/refresh`, () => HttpResponse.json({ message: 'Revoked', extra: { code: 'unauthenticated' } }, { status: 401 })),
    )
    const store = memoryTokens(tokens('a1'))
    const onSignedOut = vi.fn()
    const api = createApi({ baseUrl: BASE, tokens: store, onSignedOut })
    await expect(api.call((c) => c.GET('/api/v1/vendor/me'))).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(store.current).toBeNull()
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it('turns the error envelope into an ApiError with field messages', async () => {
    server.use(
      http.post(`${BASE}/api/v1/vendor/products`, () =>
        HttpResponse.json({ message: 'Check the highlighted fields', extra: { code: 'validation_error', fields: { title: 'Add a title' } } }, { status: 422 }),
      ),
    )
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(tokens('a1')) })
    const error = await api.call((c) => c.POST('/api/v1/vendor/products', { body: {} })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'validation_error', message: 'Check the highlighted fields', fields: { title: 'Add a title' } })
  })

  it('reports a network failure as a retryable ApiError', async () => {
    server.use(http.get(`${BASE}/api/v1/vendor/summary`, () => HttpResponse.error()))
    const api = createApi({ baseUrl: BASE, tokens: memoryTokens(tokens('a1')) })
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
