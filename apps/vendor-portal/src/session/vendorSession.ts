import { getApiClient } from '../api/instance'
import { ApiError } from '../api/errors'
import { SessionStore, isSessionResponse } from './store'

/** The store wired to the real vendor-api. `onCleared` drops the query cache of the previous user. */
export function createVendorSessionStore(onCleared: () => void): SessionStore {
  return new SessionStore({
    refresh: async () => {
      const { data } = await getApiClient().POST('/v1/auth/refresh')
      if (!isSessionResponse(data)) {
        throw new ApiError({ status: 502, code: 'bad_session_response', message: 'The server sent an unexpected answer.' })
      }
      return data
    },
    logout: async () => {
      await getApiClient().POST('/v1/auth/logout')
    },
    onCleared,
  })
}
