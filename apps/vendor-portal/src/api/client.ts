import createClient from 'openapi-fetch'
import { ApiError, NetworkError, errorFromResponse } from './errors'
import type { paths } from './schema'

export const DEFAULT_TIMEOUT_MS = 15_000
/** For the bulk import, which uploads a whole spreadsheet and is validated row by row. */
export const LONG_TIMEOUT_MS = 120_000

/** Paths whose requests are given {@link LONG_TIMEOUT_MS}. */
const LONG_PATHS = ['/v1/vendor/products/import']

export interface ApiClientOptions {
  /** The vendor-api origin, from `VITE_VENDOR_API_URL`. */
  baseUrl: string
  /** The current access token, if any. Read on every request, so a refreshed token is used at once. */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>
  timeoutMs?: number
  longTimeoutMs?: number
  /** Replaces `fetch`; for tests. */
  fetch?: typeof fetch
}

export type ApiClient = ReturnType<typeof createApiClient>

/**
 * The only way the portal talks to vendor-api. Paths, parameters and bodies are typed from
 * `openapi.json`. It always sends the cookie (the refresh cookie must reach `/v1/auth/*`), adds the
 * access token, and throws instead of returning an error object:
 * - {@link ApiError} for any non-2xx answer;
 * - {@link NetworkError} when nothing answers or the timeout passes;
 * - the browser's own `AbortError` when the caller cancels (TanStack Query does this on unmount).
 */
export function createApiClient(options: ApiClientOptions) {
  const baseFetch = options.fetch
  const shortMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const longMs = options.longTimeoutMs ?? LONG_TIMEOUT_MS

  const apiFetch = async (input: Request): Promise<Response> => {
    const token = await options.getAccessToken?.()
    const headers = new Headers(input.headers)
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    const isLong = LONG_PATHS.some((path) => new URL(input.url).pathname === path)

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, isLong ? longMs : shortMs)
    const onCallerAbort = () => controller.abort()
    if (input.signal.aborted) {
      controller.abort()
    } else {
      input.signal.addEventListener('abort', onCallerAbort, { once: true })
    }

    try {
      const request = new Request(input, { headers, signal: controller.signal })
      const response = await (baseFetch ?? fetch)(request)
      if (!response.ok) {
        throw await errorFromResponse(response)
      }
      return response
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      if (timedOut) {
        throw new NetworkError('timeout')
      }
      if (input.signal.aborted) {
        throw error
      }
      throw new NetworkError('network')
    } finally {
      clearTimeout(timer)
      input.signal.removeEventListener('abort', onCallerAbort)
    }
  }

  return createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    fetch: apiFetch,
  })
}
