import { Box, Button, CircularProgress, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useSession } from './AuthProvider'
import { BlockedPage } from './BlockedPage'
import { safeReturnTo } from './returnTo'
import type { Role } from './store'

function Loading() {
  return (
    <Box role="status" aria-label="Loading" sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <CircularProgress />
    </Box>
  )
}

function Unavailable() {
  const { retry } = useSession()
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Can't reach the server
      </Typography>
      <Typography sx={{ mb: 3 }}>Check your connection and try again. You are not signed out.</Typography>
      <Button variant="contained" onClick={() => void retry()}>
        Try again
      </Button>
    </Box>
  )
}

/**
 * Signed-in users only. Signed-out users go to the login screen with `return-to`, so they come back
 * to the same screen (after an expiry too). A blocked vendor sees the explanation here, in place.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  switch (session.status) {
    case 'loading':
      return <Loading />
    case 'unavailable':
      return <Unavailable />
    case 'blocked':
      return <BlockedPage />
    case 'signedOut': {
      const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`)
      const search = returnTo === '/' ? '' : `?return-to=${encodeURIComponent(returnTo)}`
      return <Navigate to={`/login${search}`} replace state={{ expired: session.expired }} />
    }
    case 'signedIn':
      return children ?? <Outlet />
  }
}

/** Signed-out users only (login, signup, ...). Signed-in users go to where they were headed, or the dashboard. */
export function PublicOnly({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading') return <Loading />
  if (session.status === 'signedIn') {
    const target = safeReturnTo(new URLSearchParams(location.search).get('return-to'))
    return <Navigate to={target} replace />
  }
  return children ?? <Outlet />
}

/** Pages only the vendor's owner may open. Staff see a plain "not allowed" page, not a redirect. */
export function RequireRole({ role, children }: { role: Role; children?: ReactNode }) {
  const session = useSession()
  if (session.role !== role) {
    return (
      <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
        <Typography component="h1" variant="h4" gutterBottom>
          You don't have access to this page
        </Typography>
        <Typography>Ask the owner of your vendor account to do this for you.</Typography>
      </Box>
    )
  }
  return children ?? <Outlet />
}
