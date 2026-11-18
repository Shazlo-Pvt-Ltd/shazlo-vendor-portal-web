import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, apiQueryKey } from './instance'
import { resetApiClient } from './instance'
import { downloadImportTemplate, importContentType, importProducts } from './endpoints'
import { ApiError } from './errors'
import { setAccessTokenProvider } from './session'

const BASE = 'https://api.test'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  vi.stubEnv('VITE_VENDOR_API_URL', BASE)
  resetApiClient()
})
afterEach(() => {
  server.resetHandlers()
  setAccessTokenProvider(undefined)
})
afterAll(() => server.close())

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('typed hooks', () => {
  it('load data by path, with the registered token', async () => {
    let authorization: string | null = null
    server.use(
      http.get(`${BASE}/v1/vendor/me`, ({ request }) => {
        authorization = request.headers.get('Authorization')
        return HttpResponse.json({ user: { email: 'a@b.co' }, vendor: { name: 'Brand' } })
      }),
    )
    setAccessTokenProvider(() => 'session-token')
    const { result } = renderHook(() => api.useQuery('get', '/v1/vendor/me'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.vendor.name).toBe('Brand')
    expect(authorization).toBe('Bearer session-token')
  })

  it('surface failures as ApiError, with field messages', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/login`, () =>
        HttpResponse.json(
          { error: { code: 'validation_error', message: 'bad', details: [{ loc: ['body', 'email'], msg: 'invalid', type: 'x' }] } },
          { status: 422 },
        ),
      ),
    )
    const { result } = renderHook(() => api.useMutation('post', '/v1/auth/login'), { wrapper: wrapper() })
    result.current.mutate({ body: { email: 'x', password: 'y' } as never })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as unknown as ApiError).fieldErrors).toEqual({ email: 'invalid' })
  })

  it('cancel the request when the component unmounts', async () => {
    let aborted = false
    server.use(
      http.get(`${BASE}/v1/vendor/me`, async ({ request }) => {
        request.signal.addEventListener('abort', () => (aborted = true))
        await delay('infinite')
      }),
    )
    const { unmount } = renderHook(() => api.useQuery('get', '/v1/vendor/me'), { wrapper: wrapper() })
    await new Promise((resolve) => setTimeout(resolve, 50))
    unmount()
    await waitFor(() => expect(aborted).toBe(true))
  })

  it('keys a query as [method, path, init] so it can be invalidated', () => {
    expect(apiQueryKey('/v1/vendor/me')).toEqual(['get', '/v1/vendor/me'])
    expect(apiQueryKey('/v1/vendor/products', { params: { query: { page: 2 } } })).toEqual([
      'get',
      '/v1/vendor/products',
      { params: { query: { page: 2 } } },
    ])
  })
})

describe('bulk import helpers', () => {
  it('posts the file itself as the body with its content type', async () => {
    let received: { type: string | null; body: string } | undefined
    server.use(
      http.post(`${BASE}/v1/vendor/products/import`, async ({ request }) => {
        received = { type: request.headers.get('Content-Type'), body: await request.text() }
        return HttpResponse.json({ imported: 1 })
      }),
    )
    const file = new File(['sku,name\nA1,Kurta'], 'products.csv', { type: 'text/csv' })
    await importProducts(file)
    expect(received).toEqual({ type: 'text/csv', body: 'sku,name\nA1,Kurta' })
  })

  it('refuses a file that is neither CSV nor XLSX before sending anything', async () => {
    await expect(importProducts(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(TypeError)
    expect(importContentType(new File([''], 'sheet.XLSX'))).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })

  it('downloads the template as a Blob', async () => {
    let format: string | null = null
    server.use(
      http.get(`${BASE}/v1/vendor/products/import/template`, ({ request }) => {
        format = new URL(request.url).searchParams.get('format')
        return new HttpResponse('sku,name\n', { headers: { 'Content-Type': 'text/csv' } })
      }),
    )
    const blob = await downloadImportTemplate()
    expect(format).toBe('csv')
    expect(await blob.text()).toBe('sku,name\n')
  })
})
