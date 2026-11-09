import createClient, { type Client } from 'openapi-fetch'

// Shared request runner for the shell's two backends: identity-api and (with an exchanged token) vendor-api.
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
  403: 'Your role does not allow this. Ask a super admin.',
  404: 'We could not find that. It may have been removed.',
  409: 'This changed somewhere else. Reload and try again.',
  429: 'Too many attempts. Wait a minute and try again.',
}

export function toApiError(response: Response, body: unknown): ApiError {
  const env = (body ?? {}) as Envelope
  return new ApiError(response.status, env.extra?.code ?? `http_${response.status}`, env.message || FALLBACK[response.status] || 'Something went wrong on our side. Try again in a moment.', env.extra?.fields ?? {})
}

export interface Api<Paths extends object> {
  client: Client<Paths>
  call<T>(send: (client: Client<Paths>) => Promise<Result<T>>): Promise<T>
}

// `getToken` supplies the bearer; on a 401, `renew` gets a fresh one once, shared by parallel calls.
export function createApi<Paths extends object>({ baseUrl, getToken, renew }: { baseUrl: string; getToken: () => string | null; renew?: () => Promise<boolean> }): Api<Paths> {
  const client = createClient<Paths>({ baseUrl, credentials: 'include' })
  client.use({
    onRequest({ request }) {
      const token = getToken()
      if (token && !request.headers.has('Authorization')) request.headers.set('Authorization', `Bearer ${token}`)
      request.headers.set('X-Request-Id', crypto.randomUUID())
      return request
    },
  })
  let renewing: Promise<boolean> | null = null
  const send = async <T,>(fn: (c: Client<Paths>) => Promise<Result<T>>) => {
    try {
      return await fn(client)
    } catch {
      throw new ApiError(0, 'network_error', 'You seem to be offline. Check your connection and try again.')
    }
  }
  async function call<T>(fn: (c: Client<Paths>) => Promise<Result<T>>): Promise<T> {
    let result = await send(fn)
    if (result.response.status === 401 && renew && getToken()) {
      renewing ??= renew().finally(() => {
        renewing = null
      })
      if (await renewing) result = await send(fn)
    }
    if (result.error !== undefined || !result.response.ok) throw toApiError(result.response, result.error)
    return result.data as T
  }
  return { client, call }
}
