import { ApiError, NetworkError } from '../api/errors'

export interface FriendlyError {
  /** A sentence a vendor can act on. Never a stack trace, a status code or a server detail. */
  message: string
  /** Seconds before another attempt will be accepted, when the server said so. */
  retryAfter?: number
}

/** What to tell a vendor about a failed call that is not the field's own validation problem. */
export function friendlyError(error: unknown): FriendlyError {
  if (error instanceof NetworkError) {
    return { message: error.message }
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return { message: 'Too many attempts.', retryAfter: error.retryAfter ?? 60 }
    }
    if (error.status >= 500) {
      return { message: 'Something went wrong on our side. Please try again in a moment.' }
    }
    return { message: error.message }
  }
  return { message: 'Something went wrong. Please try again.' }
}
