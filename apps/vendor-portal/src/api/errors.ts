/** The ways a call to vendor-api can fail, as values the screens can act on. */

/** One message per form field, keyed by the field's path (`email`, `variants.0.price`). */
export type FieldErrors = Record<string, string>

/** The key for a validation problem that belongs to no single field. */
export const FORM_ERROR_KEY = '_form'

/** An answer other than 2xx, from vendor-api's `{error: {code, message, request_id, details?}}`. */
export class ApiError extends Error {
  readonly status: number
  /** Machine-readable, for example `invalid_credentials` or `rate_limited`. */
  readonly code: string
  /** The `X-Request-ID`, to quote to support. */
  readonly requestId: string | undefined
  /** Seconds to wait before trying again; only on `429` (and `503`) answers that carry it. */
  readonly retryAfter: number | undefined
  /** Per-field messages of a `422`; empty for every other status. */
  readonly fieldErrors: FieldErrors

  constructor(init: {
    status: number
    code: string
    message: string
    requestId?: string
    retryAfter?: number
    fieldErrors?: FieldErrors
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
    this.retryAfter = init.retryAfter
    this.fieldErrors = init.fieldErrors ?? {}
  }
}

/** No answer arrived: the network failed or the request ran out of time. */
export class NetworkError extends Error {
  readonly kind: 'network' | 'timeout'

  constructor(kind: 'network' | 'timeout') {
    super(
      kind === 'timeout'
        ? 'The server took too long to answer.'
        : 'Could not reach the server. Check your connection and try again.',
    )
    this.name = 'NetworkError'
    this.kind = kind
  }
}

const LOCATION_PREFIXES = new Set(['body', 'query', 'path', 'header', 'cookie'])

/**
 * Turns pydantic's `details` (`[{loc: ['body', 'email'], msg, type}]`) into `{email: message}`.
 * The first message for a field wins. A problem with no field goes under `_form`.
 */
export function fieldErrorsFrom(details: unknown): FieldErrors {
  const result: FieldErrors = {}
  if (!Array.isArray(details)) {
    return result
  }
  for (const item of details) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const { loc, msg } = item as { loc?: unknown; msg?: unknown }
    if (typeof msg !== 'string') {
      continue
    }
    let path = Array.isArray(loc) ? loc.map(String) : []
    if (path.length > 0 && LOCATION_PREFIXES.has(path[0] ?? '')) {
      path = path.slice(1)
    }
    const key = path.length > 0 ? path.join('.') : FORM_ERROR_KEY
    // Pydantic prefixes checks written as validators with "Value error, ".
    result[key] ??= msg.replace(/^Value error, /, '')
  }
  return result
}

/** `Retry-After` as whole seconds. Accepts a number or an HTTP date; anything else is undefined. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim())
  }
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000))
}

/** Builds the {@link ApiError} for a non-2xx response. Never throws, whatever the body holds. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error: unknown }).error
      : undefined
  const fields = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const code = typeof fields.code === 'string' ? fields.code : 'unknown_error'
  const message =
    typeof fields.message === 'string' && fields.message !== ''
      ? fields.message
      : `The request failed (${response.status}).`
  const requestId =
    response.headers.get('X-Request-ID') ??
    (typeof fields.request_id === 'string' ? fields.request_id : undefined)
  return new ApiError({
    status: response.status,
    code,
    message,
    requestId: requestId ?? undefined,
    retryAfter: parseRetryAfter(response.headers.get('Retry-After')),
    fieldErrors: response.status === 422 ? fieldErrorsFrom(fields.details) : {},
  })
}
