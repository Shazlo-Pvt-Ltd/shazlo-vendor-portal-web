import { Box, CircularProgress } from '@mui/material'
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import type { Schemas } from '../api/client'
import { useAppContext } from '../api/context'
import { paths } from '../app/paths'
import { authCopy } from '../copy/auth'

export function useSession() {
  const { api, session, queryClient } = useAppContext()
  const status = useSyncExternalStore(session.subscribe, session.status, session.status)

  // vendor-api sets the refresh cookie on these answers; only the access token reaches this code.
  const adopt = useCallback(
    (started: Schemas['Session']) => {
      queryClient.clear()
      session.set(started.access_token)
    },
    [session, queryClient],
  )

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      adopt(await api.call((c) => c.POST('/api/v1/vendor/auth/login', { body: { identifier, password } })))
    },
    [api, adopt],
  )

  const signOut = useCallback(async () => {
    session.set(null)
    queryClient.clear()
    // The cookie identifies the session; vendor-api revokes it and clears the cookie.
    await api.call((c) => c.POST('/api/v1/vendor/auth/logout')).catch(() => undefined)
  }, [api, session, queryClient])

  return useMemo(() => ({ status, signedIn: status === 'signedIn', signIn, signOut, adopt }), [status, signIn, signOut, adopt])
}

// Shown for the moment after a page load while the refresh cookie is swapped for an access token.
function CheckingSession() {
  return (
    <Box role="status" aria-label={authCopy.checkingSession} aria-busy="true" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress aria-hidden="true" />
    </Box>
  )
}

// Sends signed-out sellers to sign in, remembering where they were going.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const location = useLocation()
  if (status === 'loading') return <CheckingSession />
  if (status === 'signedOut') {
    const next = location.pathname + location.search
    return <Navigate to={next === paths.overview ? paths.signIn : `${paths.signIn}?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

// Sign-in and apply pages are for signed-out visitors only.
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useSession()
  if (status === 'loading') return <CheckingSession />
  return status === 'signedIn' ? <Navigate to={paths.overview} replace /> : <>{children}</>
}

// Only same-site paths are followed after sign-in, never another origin.
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : paths.overview
}
