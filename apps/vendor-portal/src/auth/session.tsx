import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import type { Schemas } from '../api/client'
import { useAppContext } from '../api/context'
import { paths } from '../app/paths'

export function useSession() {
  const { api, session, queryClient } = useAppContext()
  const tokens = useSyncExternalStore(session.subscribe, session.get, session.get)

  const signIn = useCallback(
    async (identifier: string, password: string, remember: boolean) => {
      const pair = await api.call((c) => c.POST('/api/v1/vendor/auth/login', { body: { identifier, password } }))
      queryClient.clear()
      session.set({ access_token: pair.access_token, refresh_token: pair.refresh_token }, remember)
    },
    [api, session, queryClient],
  )

  const adopt = useCallback(
    (pair: Schemas['TokenPair'], remember = false) => {
      queryClient.clear()
      session.set({ access_token: pair.access_token, refresh_token: pair.refresh_token }, remember)
    },
    [session, queryClient],
  )

  const signOut = useCallback(async () => {
    const current = session.get()
    session.set(null)
    queryClient.clear()
    if (current) await api.call((c) => c.POST('/api/v1/vendor/auth/logout', { body: { refresh_token: current.refresh_token } })).catch(() => undefined)
  }, [api, session, queryClient])

  return useMemo(() => ({ signedIn: tokens !== null, signIn, signOut, adopt }), [tokens, signIn, signOut, adopt])
}

// Sends signed-out sellers to sign in, remembering where they were going.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { signedIn } = useSession()
  const location = useLocation()
  if (!signedIn) {
    const next = location.pathname + location.search
    return <Navigate to={next === paths.overview ? paths.signIn : `${paths.signIn}?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

// Sign-in and apply pages are for signed-out visitors only.
export function GuestOnly({ children }: { children: ReactNode }) {
  const { signedIn } = useSession()
  return signedIn ? <Navigate to={paths.overview} replace /> : <>{children}</>
}

// Only same-site paths are followed after sign-in, never another origin.
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : paths.overview
}
