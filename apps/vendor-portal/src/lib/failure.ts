import { ApiError, NetworkError } from '../api/errors'
import { authCopy } from '../copy/auth'

const copy = authCopy.failures

export interface Failure {
  /** A sentence a seller can act on: never a stack trace, a status code or a server's internals. */
  message: string
  /** Seconds before the server takes another attempt, after a 429. */
  retryAfter?: number
}

/** What to tell a seller about a call that failed for a reason that is not one field's problem (main's features/errors.ts). */
export function failureOf(error: unknown): Failure {
  if (error instanceof NetworkError) return { message: error.message }
  if (error instanceof ApiError) {
    if (error.status === 429) return { message: copy.tooMany, retryAfter: error.retryAfter ?? 60 }
    if (error.status >= 500) return { message: copy.ourSide }
    return { message: error.message }
  }
  return { message: copy.unknown }
}
