import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createApiClient } from './client'
import { ApiError, NetworkError, fieldErrorsFrom, parseRetryAfter } from './errors'
import type { components } from './schema'

const BASE = 'https://api.test'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function errorBody(code: string, message: string, extra: object = {}) {
  return { error: { code, message, request_id: 'req-body', ...extra } }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to fail')
}

describe('the client', () => {
  it('returns a typed body and sends the token', async () => {
    let seen: Request | undefined
    server.use(
      http.get(`${BASE}/v1/me`, ({ request }) => {
        seen = request
        return HttpResponse.json({ id: 'v1' })
      }),
    )
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => 'tok-1' })
    await client.GET('/v1/me')
    expect(seen?.headers.get('Authorization')).toBe('Bearer tok-1')
  })

  it('always sends cookies, so the refresh cookie reaches /v1/auth/*', async () => {
    let credentials: RequestCredentials | undefined
    const client = createApiClient({
      baseUrl: BASE,
      fetch: async (request) => {
        credentials = (request as Request).credentials
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
      },
    })
    await client.POST('/v1/auth/refresh')
    expect(credentials).toBe('include')
  })

  it('reads the token on every request and sends none when there is none', async () => {
    const headers: Array<string | null> = []
    server.use(
      http.get(`${BASE}/v1/me`, ({ request }) => {
        headers.push(request.headers.get('Authorization'))
        return HttpResponse.json({})
      }),
    )
    let token: string | null = null
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => token })
    await client.GET('/v1/me')
    token = 'later'
    await client.GET('/v1/me')
    expect(headers).toEqual([null, 'Bearer later'])
  })

  it('sends JSON bodies as JSON', async () => {
    let contentType: string | null = null
    server.use(
      http.post(`${BASE}/v1/auth/login`, ({ request }) => {
        contentType = request.headers.get('Content-Type')
        return HttpResponse.json({})
      }),
    )
    const client = createApiClient({ baseUrl: BASE })
    await client.POST('/v1/auth/login', { body: { email: 'a@b.co', password: 'x' } as never })
    expect(contentType).toBe('application/json')
  })
})

describe('renewing the session on a 401', () => {
  it('renews once and resends the same request, body included, with the new token', async () => {
    const seen: Array<{ auth: string | null; body: unknown }> = []
    server.use(
      http.patch(`${BASE}/v1/admins/a1`, async ({ request }) => {
        seen.push({ auth: request.headers.get('Authorization'), body: await request.json() })
        return seen.length === 1
          ? HttpResponse.json(errorBody('unauthorized', 'expired'), { status: 401 })
          : HttpResponse.json({ ok: true })
      }),
    )
    let token = 'old'
    const onUnauthorized = vi.fn(async () => {
      token = 'new'
      return true
    })
    const onApiError = vi.fn()
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => token, onUnauthorized, onApiError })
    const { data } = await client.PATCH('/v1/admins/{admin_id}', {
      params: { path: { admin_id: 'a1' } },
      body: { display_name: 'Ada' } as never,
    })
    expect(data).toEqual({ ok: true })
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(seen).toEqual([
      { auth: 'Bearer old', body: { display_name: 'Ada' } },
      { auth: 'Bearer new', body: { display_name: 'Ada' } },
    ])
    expect(onApiError).not.toHaveBeenCalled()
  })

  it('never renews for /v1/auth/*: a wrong password is a plain 401, not a refresh loop', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/login`, () =>
        HttpResponse.json(errorBody('invalid_credentials', 'Wrong'), { status: 401 }),
      ),
    )
    const onUnauthorized = vi.fn(async () => true)
    const onApiError = vi.fn()
    const client = createApiClient({ baseUrl: BASE, onUnauthorized, onApiError })
    const error = await caught(client.POST('/v1/auth/login', { body: { email: 'a@b.co', password: 'x' } as never }))
    expect((error as ApiError).code).toBe('invalid_credentials')
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onApiError).toHaveBeenCalledOnce()
  })

  it('reports the 401 when the session could not be renewed, and sends nothing more', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/v1/me`, () => {
        calls += 1
        return HttpResponse.json(errorBody('unauthorized', 'expired'), { status: 401 })
      }),
    )
    const onApiError = vi.fn()
    const client = createApiClient({ baseUrl: BASE, onUnauthorized: async () => false, onApiError })
    const error = await caught(client.GET('/v1/me'))
    expect((error as ApiError).status).toBe(401)
    expect(calls).toBe(1)
    expect(onApiError).toHaveBeenCalledWith(error)
  })

  it('reports the error of the resent request, once, when that one fails too', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/v1/me`, () => {
        calls += 1
        return calls === 1
          ? HttpResponse.json(errorBody('unauthorized', 'expired'), { status: 401 })
          : HttpResponse.json(errorBody('account_disabled', 'Suspended'), { status: 403 })
      }),
    )
    const onUnauthorized = vi.fn(async () => true)
    const onApiError = vi.fn()
    const client = createApiClient({ baseUrl: BASE, onUnauthorized, onApiError })
    const error = await caught(client.GET('/v1/me'))
    expect((error as ApiError).code).toBe('account_disabled')
    expect(calls).toBe(2)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(onApiError).toHaveBeenCalledOnce()
    expect(onApiError).toHaveBeenCalledWith(error)
  })

  it('does not renew on a 403', async () => {
    server.use(http.get(`${BASE}/v1/me`, () => HttpResponse.json(errorBody('forbidden', 'No'), { status: 403 })))
    const onUnauthorized = vi.fn(async () => true)
    const client = createApiClient({ baseUrl: BASE, onUnauthorized })
    expect(((await caught(client.GET('/v1/me'))) as ApiError).status).toBe(403)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('error mapping', () => {
  it.each([
    [401, 'unauthorized', 'Not signed in'],
    [403, 'forbidden', 'Not allowed'],
    [409, 'conflict', 'Already exists'],
  ])('turns a %i into an ApiError with its code, message and request id', async (status, code, message) => {
    server.use(
      http.get(`${BASE}/v1/me`, () =>
        HttpResponse.json(errorBody(code, message), { status, headers: { 'X-Request-ID': 'req-header' } }),
      ),
    )
    const error = await caught(createApiClient({ baseUrl: BASE }).GET('/v1/me'))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code, message, requestId: 'req-header', retryAfter: undefined })
  })

  it('maps a 422 to one message per field', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/change-password`, () =>
        HttpResponse.json(
          errorBody('validation_error', 'Request validation failed', {
            details: [
              { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
              { loc: ['body', 'email'], msg: 'second message is ignored', type: 'x' },
              { loc: ['body', 'variants', 0, 'price'], msg: 'Value error, must be positive', type: 'x' },
              { loc: ['body'], msg: 'Passwords do not match', type: 'x' },
            ],
          }),
          { status: 422 },
        ),
      ),
    )
    const error = (await caught(createApiClient({ baseUrl: BASE }).POST('/v1/auth/change-password', { body: {} as never }))) as ApiError
    expect(error.status).toBe(422)
    expect(error.fieldErrors).toEqual({
      email: 'value is not a valid email address',
      'variants.0.price': 'must be positive',
      _form: 'Passwords do not match',
    })
  })

  it('exposes Retry-After seconds on a 429', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/login`, () =>
        HttpResponse.json(errorBody('rate_limited', 'Too many requests. Try again later.'), {
          status: 429,
          headers: { 'Retry-After': '42' },
        }),
      ),
    )
    const error = (await caught(createApiClient({ baseUrl: BASE }).POST('/v1/auth/login', { body: {} as never }))) as ApiError
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 42 })
  })

  it('still gives an ApiError when the body is not the error envelope', async () => {
    server.use(http.get(`${BASE}/v1/me`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })))
    const error = await caught(createApiClient({ baseUrl: BASE }).GET('/v1/me'))
    expect(error).toMatchObject({ status: 502, code: 'unknown_error', message: 'The request failed (502).' })
  })

  it('is a NetworkError when nothing answers', async () => {
    server.use(http.get(`${BASE}/v1/me`, () => HttpResponse.error()))
    const error = await caught(createApiClient({ baseUrl: BASE }).GET('/v1/me'))
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).toMatchObject({ kind: 'network' })
  })
})

describe('timeouts and cancellation', () => {
  it('gives up after the timeout with a NetworkError of kind timeout', async () => {
    server.use(http.get(`${BASE}/v1/me`, async () => { await delay('infinite') }))
    const client = createApiClient({ baseUrl: BASE, timeoutMs: 30 })
    const error = await caught(client.GET('/v1/me'))
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).toMatchObject({ kind: 'timeout' })
  })

  it('rethrows the abort when the caller cancels, not a NetworkError', async () => {
    server.use(http.get(`${BASE}/v1/me`, async () => { await delay('infinite') }))
    const controller = new AbortController()
    const client = createApiClient({ baseUrl: BASE })
    const pending = caught(client.GET('/v1/me', { signal: controller.signal }))
    setTimeout(() => controller.abort(), 10)
    const error = await pending
    expect(error).not.toBeInstanceOf(NetworkError)
    expect(error).not.toBeInstanceOf(ApiError)
    expect((error as Error).name).toBe('AbortError')
  })

  it('does not leave a timer running after the answer', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    server.use(http.get(`${BASE}/v1/me`, () => HttpResponse.json({})))
    await createApiClient({ baseUrl: BASE }).GET('/v1/me')
    expect(clear).toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('parses Retry-After as seconds or a date and ignores junk', () => {
    expect(parseRetryAfter('120')).toBe(120)
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(30)
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })

  it('ignores validation details it cannot read', () => {
    expect(fieldErrorsFrom(undefined)).toEqual({})
    expect(fieldErrorsFrom([null, 5, { loc: ['body', 'a'] }])).toEqual({})
  })
})

describe('generated types', () => {
  it('match a sample response', async () => {
    type Profile = components['schemas']['AdminProfile']
    const sample: Profile = {
      id: '0b0c7a5e-2b6e-4c43-9a3a-3f1f2f0f9d11',
      email: 'admin@shazlo.test',
      display_name: 'Admin',
      roles: ['super_admin'],
      must_change_password: false,
    }
    server.use(http.get(`${BASE}/v1/me`, () => HttpResponse.json(sample)))
    const { data } = await createApiClient({ baseUrl: BASE }).GET('/v1/me')
    expectTypeOf(data).toEqualTypeOf<Profile | undefined>()
    expect(data).toEqual(sample)
  })
})
