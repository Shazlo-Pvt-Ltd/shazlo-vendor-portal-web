import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { registerSessionHooks } from '../api/session'
import type { components } from '../api/schema'
import { createAdminSessionStore } from './adminSession'
import type { ModuleToken, SessionState, SessionStore } from './store'

type SessionResponse = components['schemas']['SessionResponse']

export interface Session extends SessionState {
  /** Takes the session a sign-in or change-password call returned. */
  signIn: (session: SessionResponse) => void
  logout: () => Promise<void>
  /** After `unavailable`. */
  retry: () => Promise<void>
  /** Gets a new token and reads `GET /v1/me` again now, so the admin's roles are current (true when signed in). */
  renew: () => Promise<boolean>
  /** A short token for one module's backend; the iframe host uses it. */
  getModuleToken: (audience: string) => Promise<ModuleToken>
}

const StoreContext = createContext<SessionStore | undefined>(undefined)

interface Props {
  children: ReactNode
  /** For tests; the app builds its own. */
  store?: SessionStore
}

/**
 * Restores the session on load and keeps it alive. Put it inside the `QueryClientProvider`: ending
 * a session clears the query cache so the next admin never sees the previous one's data.
 */
export function AuthProvider({ children, store: provided }: Props) {
  const queryClient = useQueryClient()
  const [store] = useState(() => provided ?? createAdminSessionStore(() => queryClient.clear()))

  useEffect(() => {
    registerSessionHooks({
      getAccessToken: store.getAccessToken,
      onUnauthorized: store.renew,
    })
    void store.start()
    return () => {
      registerSessionHooks(undefined)
      store.close()
    }
  }, [store])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useSession(): Session {
  const store = useContext(StoreContext)
  if (store === undefined) {
    throw new Error('useSession must be used inside AuthProvider.')
  }
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(
    () => ({
      ...state,
      signIn: (session) => store.signIn(session),
      logout: () => store.logout(),
      retry: () => store.retry(),
      renew: () => store.renew(),
      getModuleToken: (audience) => store.getModuleToken(audience),
    }),
    [state, store],
  )
}
