import type { TokenStore } from '../api/client'

// Earlier builds kept the access and refresh tokens in web storage under this key. Any copy left
// behind is removed, so no refresh token stays where page scripts can read it.
const LEGACY_KEY = 'shazlo.seller.session'

// `loading` until the first answer after a page load: there is no token in memory yet, and the
// refresh cookie may still hold a session.
export type SessionStatus = 'loading' | 'signedIn' | 'signedOut'

/*
 * The seller's session, as vendor-api and main's portal keep it (ADR 0009): the 15-minute access
 * token lives in memory only, and the refresh token is the HttpOnly `vendor_refresh` cookie, which
 * page code never sees. Nothing here touches localStorage or sessionStorage, so a script injected
 * into the page cannot carry a session away.
 */
export interface SessionStore extends TokenStore {
  status(): SessionStatus
  subscribe(listener: () => void): () => void
}

function forgetLegacyTokens() {
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      storage().removeItem(LEGACY_KEY)
    } catch {
      // No storage here, or it is blocked: there is nothing to remove.
    }
  }
}

export function createSessionStore(): SessionStore {
  forgetLegacyTokens()
  let token: string | null = null
  let status: SessionStatus = 'loading'
  const listeners = new Set<() => void>()

  return {
    get: () => token,
    status: () => status,
    set(next) {
      token = next
      status = next === null ? 'signedOut' : 'signedIn'
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
