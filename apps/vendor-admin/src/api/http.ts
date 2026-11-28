import createClient, { type Client } from 'openapi-fetch'

// The admin's request runner for vendor-api, called with the token the shell exchanged for audience vendor-api.
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>
  /** The request ID to quote to support (`X-Request-Id`, else the body's `request_id`). */
  readonly requestId: string | undefined
  /** Seconds to wait before retrying, from `Retry-After` on a 429. */
  readonly retryAfter: number | undefined

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, extra: { requestId?: string; retryAfter?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.requestId = extra.requestId
    this.retryAfter = extra.retryAfter
  }
}

// Both services answer every error as {error: {code, message, request_id, details?}}.
type Envelope = { error?: { code?: unknown; message?: unknown; request_id?: unknown; details?: unknown } }
type Result<T> = { data?: T; error?: unknown; response: Response }

const FALLBACK: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  403: 'Your role does not allow this. Ask a super admin.',
  404: 'We could not find that. It may have been removed.',
  409: 'This changed somewhere else. Reload and try again.',
  429: 'Too many attempts. Wait a minute and try again.',
}

const LOCATION_PREFIXES = new Set(['body', 'query', 'path', 'header', 'cookie'])

// A 422's `details` is pydantic's [{loc: ['body', 'email'], msg, type}]. The first message per field wins.
function fieldsFromDetails(details: unknown): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!Array.isArray(details)) return fields
  for (const item of details) {
    if (typeof item !== 'object' || item === null) continue
    const { loc, msg } = item as { loc?: unknown; msg?: unknown }
    if (typeof msg !== 'string') continue
    let path = Array.isArray(loc) ? loc.map(String) : []
    if (LOCATION_PREFIXES.has(path[0] ?? '')) path = path.slice(1)
    fields[path.length > 0 ? path.join('.') : '_form'] ??= msg.replace(/^Value error, /, '')
  }
  return fields
}

// vendor-api's own 409s, in the screens' wording (the server's text is for logs, not for reviewers).
const MESSAGE_BY_CODE: Record<string, string> = {
  stale_review: 'This changed since you opened it. Reload to see the latest version.',
  review_already_decided: 'This was already decided by someone else. Reload to see the result.',
  invalid_status_transition: 'This vendor’s status changed. Reload and try again.',
  commission_changed: 'The brand changed its proposed rate. Reload to review the new one.',
  no_proposal: 'There is no proposed rate waiting.',
}

function retryAfterSeconds(value: string | null): number | undefined {
  return value !== null && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined
}

export function toApiError(response: Response, body: unknown): ApiError {
  const inner = (typeof body === 'object' && body !== null ? (body as Envelope).error : undefined) ?? {}
  const code = typeof inner.code === 'string' && inner.code !== '' ? inner.code : `http_${response.status}`
  // Own keys only: a code like `constructor` must not read Object.prototype.
  const message = (Object.hasOwn(MESSAGE_BY_CODE, code) ? MESSAGE_BY_CODE[code] : undefined) ?? (typeof inner.message === 'string' && inner.message !== '' ? inner.message : FALLBACK[response.status] || 'Something went wrong on our side. Try again in a moment.')
  const requestId = response.headers.get('X-Request-Id') ?? (typeof inner.request_id === 'string' ? inner.request_id : undefined)
  const fields = response.status === 422 ? fieldsFromDetails(inner.details) : {}
  return new ApiError(response.status, code, message, fields, { requestId, retryAfter: retryAfterSeconds(response.headers.get('Retry-After')) })
}

export interface Api<Paths extends object> {
  client: Client<Paths>
  call<T>(send: (client: Client<Paths>) => Promise<Result<T>>): Promise<T>
}

// `getToken` supplies the bearer; on a 401, `renew` gets a fresh one once, shared by parallel calls.
// Only identity-api needs cookies (its HttpOnly refresh cookie); other APIs use bearer tokens, and
// sending credentials cross-origin would also require Access-Control-Allow-Credentials there.
export function createApi<Paths extends object>({ baseUrl, getToken, renew, withCookies = false }: { baseUrl: string; getToken: () => string | null; renew?: () => Promise<boolean>; withCookies?: boolean }): Api<Paths> {
  const client = createClient<Paths>({ baseUrl, credentials: withCookies ? 'include' : 'same-origin' })
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
