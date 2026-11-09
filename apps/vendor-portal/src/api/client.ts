import createClient, { type Client } from 'openapi-fetch'
import type { components, paths } from './schema'

export type Schemas = components['schemas']
export type Tokens = { access_token: string; refresh_token: string }

export interface TokenStore {
  get(): Tokens | null
  set(tokens: Tokens | null): void
}

// One shape for every failure, so screens can show `message` and map `fields` onto inputs.
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

type Envelope = { message?: string; extra?: { code?: string; fields?: Record<string, string> } }
type Result<T> = { data?: T; error?: unknown; response: Response }

const FALLBACK: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  404: 'We could not find that. It may have been removed.',
  409: 'This changed somewhere else. Reload and try again.',
  413: 'That file is too large.',
  415: 'That file type is not supported.',
  429: 'Too many attempts. Wait a minute and try again.',
}

function toApiError(response: Response, body: unknown): ApiError {
  const env = (body ?? {}) as Envelope
  const message = env.message || FALLBACK[response.status] || 'Something went wrong on our side. Try again in a moment.'
  return new ApiError(response.status, env.extra?.code ?? `http_${response.status}`, message, env.extra?.fields ?? {})
}

export interface Api {
  client: Client<paths>
  // Runs one request: refreshes the session once on 401, throws ApiError on failure, returns data.
  call<T>(send: (client: Client<paths>) => Promise<Result<T>>): Promise<T>
}

export function createApi({ baseUrl, tokens, onSignedOut }: { baseUrl: string; tokens: TokenStore; onSignedOut?: () => void }): Api {
  const client = createClient<paths>({ baseUrl })
  client.use({
    onRequest({ request }) {
      const current = tokens.get()
      if (current && !request.headers.has('Authorization')) request.headers.set('Authorization', `Bearer ${current.access_token}`)
      request.headers.set('X-Request-Id', crypto.randomUUID())
      return request
    },
  })

  // Parallel 401s share one refresh, so a rotated refresh token is used only once.
  let refreshing: Promise<boolean> | null = null
  async function refresh(): Promise<boolean> {
    const current = tokens.get()
    if (!current) return false
    const { data } = await client.POST('/api/v1/vendor/auth/refresh', {
      body: { refresh_token: current.refresh_token },
      headers: { Authorization: '' },
    })
    if (!data) return false
    tokens.set({ access_token: data.access_token, refresh_token: data.refresh_token })
    return true
  }

  async function send<T>(fn: (client: Client<paths>) => Promise<Result<T>>): Promise<Result<T>> {
    try {
      return await fn(client)
    } catch {
      throw new ApiError(0, 'network_error', 'You seem to be offline. Check your connection and try again.')
    }
  }

  async function call<T>(fn: (client: Client<paths>) => Promise<Result<T>>): Promise<T> {
    const signedIn = tokens.get() !== null
    let result = await send(fn)
    if (result.response.status === 401 && signedIn) {
      refreshing ??= refresh().finally(() => {
        refreshing = null
      })
      if (await refreshing) {
        result = await send(fn)
      } else if (tokens.get() !== null) {
        // Only the first of several parallel failures signs the seller out.
        tokens.set(null)
        onSignedOut?.()
      }
    }
    if (result.error !== undefined || !result.response.ok) throw toApiError(result.response, result.error)
    return result.data as T
  }

  return { client, call }
}
