import createQueryClient from 'openapi-react-query'
import { loadEnv } from '../config/env'
import { createApiClient, type ApiClient } from './client'
import { currentAccessToken } from './session'

let client: ApiClient | undefined

/** The portal's one client, built on first use from the environment. */
export function getApiClient(): ApiClient {
  if (client === undefined) {
    const env = loadEnv()
    if (!env.ok) {
      // The app shows the misconfiguration screen before any screen can call the API.
      throw new Error('The portal is misconfigured: VITE_VENDOR_API_URL is not usable.')
    }
    client = createApiClient({ baseUrl: env.env.apiUrl, getAccessToken: currentAccessToken })
  }
  return client
}

/** Forgets the client; for tests that change the environment. */
export function resetApiClient(): void {
  client = undefined
}

/** A stand-in with the client's shape that finds the real client at call time. */
const lazyClient = new Proxy({} as ApiClient, {
  get: (_target, method) => (...args: unknown[]) =>
    (getApiClient() as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[method]!(...args),
})

/**
 * Typed TanStack Query hooks: `api.useQuery('get', '/v1/vendor/me')`,
 * `api.useMutation('post', '/v1/auth/login')`. Features pass a path from the OpenAPI file, never a
 * URL, and get typed parameters, bodies and results.
 */
export const api = createQueryClient(lazyClient)

/** The key `api.useQuery('get', path, init)` caches under; use it to invalidate or prefetch. */
export function apiQueryKey(path: string, init?: unknown) {
  return init === undefined ? (['get', path] as const) : (['get', path, init] as const)
}
