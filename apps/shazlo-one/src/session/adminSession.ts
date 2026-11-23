import { createApiClient } from '../api/client'
import { ApiError } from '../api/errors'
import { getApiClient } from '../api/instance'
import { loadEnv } from '../config/env'
import { SessionStore, isAdminProfile } from './store'

function bad(): never {
  throw new ApiError({ status: 502, code: 'bad_session_response', message: 'The server sent an unexpected answer.' })
}

/**
 * The store wired to the real identity-api. `onCleared` drops the query cache of the previous admin.
 *
 * `GET /v1/me` and `POST /v1/auth/token` go through a client of their own that has no renewal hook:
 * `/v1/me` runs inside a renewal, and a renewal that waits for itself never ends.
 */
export function createAdminSessionStore(onCleared: () => void): SessionStore {
  const bare = (token: string) => {
    const env = loadEnv()
    if (!env.ok) throw new Error('The shell is misconfigured: VITE_IDENTITY_API_URL is not usable.')
    return createApiClient({ baseUrl: env.env.apiUrl, getAccessToken: () => token })
  }
  return new SessionStore({
    refresh: async () => {
      const { data } = await getApiClient().POST('/v1/auth/refresh')
      return data ?? bad()
    },
    fetchMe: async (token) => {
      const { data } = await bare(token).GET('/v1/me')
      return isAdminProfile(data) ? data : bad()
    },
    exchange: async (audience, token) => {
      const { data } = await bare(token).POST('/v1/auth/token', { body: { audience } })
      return data ?? bad()
    },
    logout: async () => {
      await getApiClient().POST('/v1/auth/logout')
    },
    onCleared,
  })
}
