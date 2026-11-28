import { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { SessionStore, type SessionDeps } from '../session/store'
import { ApiError, createApi, type Api } from './http'
import type { paths as IdentityPaths } from './identity'

export interface AppContext {
  session: SessionStore
  identity: Api<IdentityPaths>
  queryClient: QueryClient
}

// identity-api checks roles in its database, so an admin whose role was just removed is refused at once.
// A 403 on any call reads the session again (the screens then follow the new roles), at most this often,
// so a session that comes back unchanged cannot start a loop.
export const FORBIDDEN_RENEW_GAP_MS = 10_000

// The shell's session (session/store.ts) and identity-api client. Modules' backends are reached with
// their own exchanged tokens (api/modules.ts); the shell has no client for any of them (ADR 0011).
export function createAppContext({ identityUrl, channel }: { identityUrl: string; channel?: SessionDeps['channel'] }): AppContext {
  // The session needs the client (to refresh) and the client needs the session (its token): the
  // client only reads `session` when a request is made, after both exist.
  let lastForbiddenRenew = Number.NEGATIVE_INFINITY
  const identity = createApi<IdentityPaths>({
    baseUrl: identityUrl,
    getToken: () => session.accessToken(),
    renew: () => session.renew(),
    onForbidden: () => {
      const now = Date.now()
      if (session.get().status !== 'signed_in' || now - lastForbiddenRenew < FORBIDDEN_RENEW_GAP_MS) return
      lastForbiddenRenew = now
      void session.renew()
    },
    withCookies: true,
  })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: (n, e) => n < 2 && e instanceof ApiError && (e.status === 0 || e.status >= 500) },
      mutations: { retry: false },
    },
  })
  const session: SessionStore = new SessionStore({
    // Not through the client's 401 renewal: that calls renew() again, which would wait on itself.
    refresh: () => identity.call((c) => c.POST('/v1/auth/refresh'), { renew: false }),
    exchange: (audience, accessToken) => identity.call((c) => c.POST('/v1/auth/token', { body: { audience }, headers: { Authorization: `Bearer ${accessToken}` } }), { renew: false }),
    logout: () => identity.call((c) => c.POST('/v1/auth/logout'), { renew: false }),
    // Everything cached for the last admin (queries, and mutations with what they sent) goes.
    onCleared: () => queryClient.clear(),
    channel,
  })
  return { session, identity, queryClient }
}

export function apiUrls(identityUrl: string | undefined = import.meta.env.VITE_IDENTITY_API_URL as string | undefined) {
  const origin = typeof window !== 'undefined' && window.location.origin !== 'null' ? window.location.origin : 'http://localhost'
  return { identityUrl: (identityUrl ?? origin).replace(/\/+$/, '') }
}

const Context = createContext<AppContext | null>(null)
export const AppContextProvider = ({ value, children }: { value: AppContext; children: ReactNode }) => <Context.Provider value={value}>{children}</Context.Provider>
export function useAppContext() {
  const value = useContext(Context)
  if (!value) throw new Error('useAppContext needs an AppContextProvider')
  return value
}
