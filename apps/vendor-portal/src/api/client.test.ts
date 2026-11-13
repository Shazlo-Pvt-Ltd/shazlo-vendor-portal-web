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
      http.get(`${BASE}/v1/vendor/me`, ({ request }) => {
        seen = request
        return HttpResponse.json({ id: 'v1' })
      }),
    )
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => 'tok-1' })
    await client.GET('/v1/vendor/me')
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
      http.get(`${BASE}/v1/vendor/me`, ({ request }) => {
        headers.push(request.headers.get('Authorization'))
        return HttpResponse.json({})
      }),
    )
    let token: string | null = null
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => token })
    await client.GET('/v1/vendor/me')
    token = 'later'
    await client.GET('/v1/vendor/me')
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

describe('error mapping', () => {
  it.each([
    [401, 'unauthorized', 'Not signed in'],
    [403, 'forbidden', 'Not allowed'],
    [409, 'conflict', 'Already exists'],
  ])('turns a %i into an ApiError with its code, message and request id', async (status, code, message) => {
    server.use(
      http.get(`${BASE}/v1/vendor/me`, () =>
        HttpResponse.json(errorBody(code, message), { status, headers: { 'X-Request-ID': 'req-header' } }),
      ),
    )
    const error = await caught(createApiClient({ baseUrl: BASE }).GET('/v1/vendor/me'))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code, message, requestId: 'req-header', retryAfter: undefined })
  })

  it('maps a 422 to one message per field', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/signup`, () =>
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
    const error = (await caught(createApiClient({ baseUrl: BASE }).POST('/v1/auth/signup', { body: {} as never }))) as ApiError
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
    server.use(http.get(`${BASE}/v1/vendor/me`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })))
    const error = await caught(createApiClient({ baseUrl: BASE }).GET('/v1/vendor/me'))
    expect(error).toMatchObject({ status: 502, code: 'unknown_error', message: 'The request failed (502).' })
  })

  it('is a NetworkError when nothing answers', async () => {
    server.use(http.get(`${BASE}/v1/vendor/me`, () => HttpResponse.error()))
    const error = await caught(createApiClient({ baseUrl: BASE }).GET('/v1/vendor/me'))
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).toMatchObject({ kind: 'network' })
  })
})

describe('timeouts and cancellation', () => {
  it('gives up after the timeout with a NetworkError of kind timeout', async () => {
    server.use(http.get(`${BASE}/v1/vendor/me`, async () => { await delay('infinite') }))
    const client = createApiClient({ baseUrl: BASE, timeoutMs: 30 })
    const error = await caught(client.GET('/v1/vendor/me'))
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).toMatchObject({ kind: 'timeout' })
  })

  it('gives the bulk import longer than other calls', async () => {
    server.use(
      http.post(`${BASE}/v1/vendor/products/import`, async () => {
        await delay(80)
        return HttpResponse.json({})
      }),
      http.get(`${BASE}/v1/vendor/me`, async () => {
        await delay(80)
        return HttpResponse.json({})
      }),
    )
    const client = createApiClient({ baseUrl: BASE, timeoutMs: 30, longTimeoutMs: 1000 })
    await expect(
      client.POST('/v1/vendor/products/import', {
        body: 'a,b' as never,
        bodySerializer: (b: unknown) => b as BodyInit,
        headers: { 'Content-Type': 'text/csv' },
      }),
    ).resolves.toBeDefined()
    expect(await caught(client.GET('/v1/vendor/me'))).toBeInstanceOf(NetworkError)
  })

  it('rethrows the abort when the caller cancels, not a NetworkError', async () => {
    server.use(http.get(`${BASE}/v1/vendor/me`, async () => { await delay('infinite') }))
    const controller = new AbortController()
    const client = createApiClient({ baseUrl: BASE })
    const pending = caught(client.GET('/v1/vendor/me', { signal: controller.signal }))
    setTimeout(() => controller.abort(), 10)
    const error = await pending
    expect(error).not.toBeInstanceOf(NetworkError)
    expect(error).not.toBeInstanceOf(ApiError)
    expect((error as Error).name).toBe('AbortError')
  })

  it('does not leave a timer running after the answer', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    server.use(http.get(`${BASE}/v1/vendor/me`, () => HttpResponse.json({})))
    await createApiClient({ baseUrl: BASE }).GET('/v1/vendor/me')
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
    type Me = components['schemas']['Me']
    const sample: Me = {
      user: { id: 'u1', email: 'owner@brand.test', role: 'owner', last_login_at: null } as Me['user'],
      vendor: { id: 'v1', name: 'Brand', slug: 'brand', status: 'approved' } as Me['vendor'],
    }
    server.use(http.get(`${BASE}/v1/vendor/me`, () => HttpResponse.json(sample)))
    const { data } = await createApiClient({ baseUrl: BASE }).GET('/v1/vendor/me')
    expectTypeOf(data).toEqualTypeOf<Me | undefined>()
    expect(data).toEqual(sample)
  })
})
