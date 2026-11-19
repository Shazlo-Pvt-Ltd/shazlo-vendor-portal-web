import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { registerSessionHooks } from '../api/session'
import type { components } from '../api/schema'
import type { Role, SessionState, SessionStore } from './store'
import { createVendorSessionStore } from './vendorSession'

type SessionResponse = components['schemas']['SessionResponse']

export interface Session extends SessionState {
  /** Takes the session a login call returned (the login screen calls this). */
  signIn: (session: SessionResponse) => void
  /** The login answered `403 vendor_not_allowed`. */
  markBlocked: () => void
  logout: () => Promise<void>
  /** After `unavailable`. */
  retry: () => Promise<void>
}

const StoreContext = createContext<SessionStore | undefined>(undefined)

interface Props {
  children: ReactNode
  /** For tests; the app builds its own. */
  store?: SessionStore
}

/**
 * Restores the session on load and keeps it alive. Put it inside the `QueryClientProvider`: ending
 * a session clears the query cache so the next user never sees the previous one's data.
 */
export function AuthProvider({ children, store: provided }: Props) {
  const queryClient = useQueryClient()
  const [store] = useState(() => provided ?? createVendorSessionStore(() => queryClient.clear()))

  useEffect(() => {
    registerSessionHooks({
      getAccessToken: store.getAccessToken,
      onUnauthorized: store.renew,
      onApiError: (error) => {
        // Suspended or rejected while working: the same page as at sign-in, not an error on every call.
        if (error.code === 'vendor_not_allowed') store.markBlocked()
      },
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
      markBlocked: () => store.markBlocked(),
      logout: () => store.logout(),
      retry: () => store.retry(),
    }),
    [state, store],
  )
}

export type { Role }
