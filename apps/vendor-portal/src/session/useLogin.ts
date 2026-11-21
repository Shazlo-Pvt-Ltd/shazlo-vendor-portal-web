import { ApiError, NetworkError } from '../api/errors'
import { api } from '../api/instance'
import { useSession } from './AuthProvider'
import { isSessionResponse } from './store'

/** The one answer for every bad login. It never says which part was wrong. */
export const BAD_LOGIN_MESSAGE = 'That email and password do not match.'

const OUR_SIDE = 'Something went wrong on our side. Try again in a moment.'

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'blocked' }
  | { ok: false; reason: 'failed'; message: string; retryAfter?: number }

function failure(message: string, retryAfter?: number): LoginResult {
  return { ok: false, reason: 'failed', message, retryAfter }
}

/**
 * `POST /v1/auth/login`, handed to the session. Every kind of bad login (unknown email, wrong
 * password, unverified, disabled) gets {@link BAD_LOGIN_MESSAGE}; a rejected or suspended vendor
 * gets the blocked page. The mutation keeps no copy of the password once the call has ended.
 */
export function useLogin() {
  const session = useSession()
  const login = api.useMutation('post', '/v1/auth/login', { gcTime: 0 })

  async function submit(email: string, password: string): Promise<LoginResult> {
    try {
      const answer = await login.mutateAsync({ body: { email, password } })
      if (!isSessionResponse(answer)) return failure(OUR_SIDE)
      session.signIn(answer)
      return { ok: true }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'vendor_not_allowed') {
        session.markBlocked()
        return { ok: false, reason: 'blocked' }
      }
      if (caught instanceof ApiError && caught.status === 401) return failure(BAD_LOGIN_MESSAGE)
      if (caught instanceof ApiError && caught.status === 422) return failure('Check your email and password, then try again.')
      if (caught instanceof ApiError && caught.status === 429) return failure('Too many attempts.', caught.retryAfter ?? 60)
      if (caught instanceof NetworkError) return failure(caught.message)
      return failure(OUR_SIDE)
    } finally {
      // The mutation object keeps what it was called with: drop it, or the password stays in the query cache.
      login.reset()
    }
  }

  return { submit, pending: login.isPending }
}
