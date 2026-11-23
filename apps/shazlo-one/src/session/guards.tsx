import { Box, Button, CircularProgress, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { CHANGE_PASSWORD_PATH, LOGIN_PATH } from '../app/shellPaths'
import { useSession } from './AuthProvider'
import { safeReturnTo } from './returnTo'

/** The forced password-change screen, carrying the (already checked) place to continue to. */
function passwordChangeTo(returnTo: string): string {
  return returnTo === '/' ? CHANGE_PASSWORD_PATH : `${CHANGE_PASSWORD_PATH}?return-to=${encodeURIComponent(returnTo)}`
}

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
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
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
 * Signed-in admins only. Signed-out admins go to the login screen with `return-to`, so they come back
 * to the same screen (after an expiry too). An admin who must change their password goes to that
 * screen and nowhere else.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  switch (session.status) {
    case 'loading':
      return <Loading />
    case 'unavailable':
      return <Unavailable />
    case 'passwordChangeRequired':
      // Remember where the admin was going: after choosing a password they continue there.
      return <Navigate to={passwordChangeTo(safeReturnTo(`${location.pathname}${location.search}${location.hash}`))} replace />
    case 'signedOut': {
      // After a deliberate sign-out the next sign-in starts fresh; otherwise it returns to this screen.
      const returnTo = session.signedOutByUser ? '/' : safeReturnTo(`${location.pathname}${location.search}${location.hash}`)
      const search = returnTo === '/' ? '' : `?return-to=${encodeURIComponent(returnTo)}`
      return <Navigate to={`${LOGIN_PATH}${search}`} replace state={{ expired: session.expired }} />
    }
    case 'signedIn':
      return children ?? <Outlet />
  }
}

/**
 * The change-password screen: a signed-in admin may open it, and the admin who must change their
 * password may open nothing else. Signed-out admins go to login.
 */
export function RequirePasswordChange({ children }: { children?: ReactNode }) {
  const session = useSession()
  switch (session.status) {
    case 'loading':
      return <Loading />
    case 'unavailable':
      return <Unavailable />
    case 'signedOut':
      return <Navigate to={LOGIN_PATH} replace state={{ expired: session.expired }} />
    default:
      return children ?? <Outlet />
  }
}

/** Signed-out admins only (login). Signed-in admins go to where they were headed, or home. */
export function PublicOnly({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading') return <Loading />
  const target = safeReturnTo(new URLSearchParams(location.search).get('return-to'))
  if (session.status === 'passwordChangeRequired') return <Navigate to={passwordChangeTo(target)} replace />
  if (session.status === 'signedIn') return <Navigate to={target} replace />
  return children ?? <Outlet />
}

/**
 * Pages only some roles may open: the admin must hold at least one of `anyOf`. Anyone else sees a
 * "not allowed" page (a 403) in place, never the page itself, an empty list or a redirect.
 */
export function RequireRole({ anyOf, children }: { anyOf: readonly string[]; children?: ReactNode }) {
  const session = useSession()
  if (!anyOf.some((role) => session.roles.includes(role))) {
    return (
      <Box component="main" sx={{ p: 3, maxWidth: 720, mx: 'auto', mt: 8 }}>
        <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
          You don't have access to this page
        </Typography>
        <Typography sx={{ mb: 3 }}>
          Your role does not allow it (error 403). Ask a super admin if you need something done here.
        </Typography>
        <Button component={Link} to="/" variant="contained">
          Go home
        </Button>
      </Box>
    )
  }
  return children ?? <Outlet />
}
