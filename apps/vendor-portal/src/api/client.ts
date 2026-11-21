import createClient, { type Client } from 'openapi-fetch'
import type { components, paths } from './schema'

export type Schemas = components['schemas']

// Where the client finds the access token (in memory, src/auth/tokens.ts). The refresh token is
// never handled here: it is the HttpOnly `vendor_refresh` cookie, which the browser sends itself.
export interface TokenStore {
  get(): string | null
  set(accessToken: string | null): void
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

const OFFLINE = 'You seem to be offline. Check your connection and try again.'

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
  // Swaps the refresh cookie for a new access token; used after a page load, when memory is empty.
  // Resolves true when there is a session. Without one the store ends up signed out.
  refresh(): Promise<boolean>
}

// `failed`: the server could not be reached or did not answer (429, 5xx); the session may be fine.
type Renewal = { outcome: 'renewed' } | { outcome: 'rejected' } | { outcome: 'failed'; error: ApiError }

const codeOf = (body: unknown) => (body as Envelope | undefined)?.extra?.code

export function createApi({
  baseUrl,
  tokens,
  onSignedOut,
  conflictWaitMs = 400,
}: {
  baseUrl: string
  tokens: TokenStore
  onSignedOut?: () => void
  // How long to wait before retrying a `409 refresh_conflict`.
  conflictWaitMs?: number
}): Api {
  // `include`, so the refresh cookie reaches the auth routes when vendor-api is on another origin.
  const client = createClient<paths>({ baseUrl, credentials: 'include' })
  client.use({
    onRequest({ request }) {
      const current = tokens.get()
      if (current && !request.headers.has('Authorization')) request.headers.set('Authorization', `Bearer ${current}`)
      request.headers.set('X-Request-Id', crypto.randomUUID())
      return request
    },
  })

  // The cookie alone authenticates a refresh; no stale access token goes with it.
  const postRefresh = () => client.POST('/api/v1/vendor/auth/refresh', { headers: { Authorization: '' } })

  async function renewOnce(): Promise<Renewal> {
    const before = tokens.get()
    let renewal: Renewal
    let access: string | undefined
    try {
      let result = await postRefresh()
      if (result.response.status === 409 && codeOf(result.error) === 'refresh_conflict') {
        // Another tab used the cookie a moment ago, and the browser already holds its replacement.
        await new Promise((resolve) => setTimeout(resolve, conflictWaitMs))
        result = await postRefresh()
      }
      access = result.data?.access_token
      const status = result.response.status
      if (access) renewal = { outcome: 'renewed' }
      else if (status === 401 || status === 403) renewal = { outcome: 'rejected' }
      else renewal = { outcome: 'failed', error: toApiError(result.response, result.error) }
    } catch {
      renewal = { outcome: 'failed', error: new ApiError(0, 'network_error', OFFLINE) }
    }
    // A sign-in, sign-out or accepted invite while this was under way wins over its answer.
    if (tokens.get() !== before) return { outcome: tokens.get() === null ? 'rejected' : 'renewed' }
    if (access) {
      tokens.set(access)
    } else if (before === null) {
      // After a page load there is no session to keep: show the sign-in page.
      tokens.set(null)
    } else if (renewal.outcome === 'rejected') {
      tokens.set(null)
      onSignedOut?.()
    }
    // A failure with a session keeps it: the cookie may still be good once the server answers.
    return renewal
  }

  // Parallel callers share one refresh, since vendor-api rotates the cookie on every use.
  let renewing: Promise<Renewal> | null = null
  function renew(): Promise<Renewal> {
    renewing ??= renewOnce().finally(() => {
      renewing = null
    })
    return renewing
  }

  async function send<T>(fn: (client: Client<paths>) => Promise<Result<T>>): Promise<Result<T>> {
    try {
      return await fn(client)
    } catch {
      throw new ApiError(0, 'network_error', OFFLINE)
    }
  }

  async function call<T>(fn: (client: Client<paths>) => Promise<Result<T>>): Promise<T> {
    const sentWith = tokens.get()
    let result = await send(fn)
    if (result.response.status === 401 && sentWith !== null) {
      const now = tokens.get()
      if (now === sentWith) {
        const renewal = await renew()
        if (renewal.outcome === 'renewed') result = await send(fn)
        else if (renewal.outcome === 'failed') throw renewal.error
      } else if (now !== null) {
        // Someone signed in, or a parallel caller already renewed, while this was out: try once
        // with that session instead of rotating the cookie again.
        result = await send(fn)
      }
      // Signed out while this was out: the 401 stands. A refresh now would turn the cookie,
      // which may outlive a failed logout request, back into a session.
    }
    if (result.error !== undefined || !result.response.ok) throw toApiError(result.response, result.error)
    return result.data as T
  }

  return { client, call, refresh: async () => (await renew()).outcome === 'renewed' }
}
