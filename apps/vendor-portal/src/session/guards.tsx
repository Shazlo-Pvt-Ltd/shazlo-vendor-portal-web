import { Box, Button, CircularProgress } from '@mui/material'
import { neutral } from '@shazlo/ui'
import { useState, type ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { Notice, PlainPage } from '../components/Notice'
import { frameCopy as copy } from '../copy/frame'
import { useSession } from './AuthProvider'
import { BlockedPage } from './BlockedPage'
import { loginPath, nextFrom } from './returnTo'
import type { Role } from './store'

/** While the session is restored from the refresh cookie. */
export function SessionLoading() {
  return (
    <Box role="status" aria-label={copy.loading} sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', bgcolor: neutral.canvas, color: neutral.inkSecondary }}>
      <CircularProgress color="inherit" aria-hidden="true" />
    </Box>
  )
}

function Unavailable() {
  const { retry } = useSession()
  return (
    <PlainPage>
      <Notice
        title={copy.unavailable.title}
        illustration="clock"
        actions={
          <Button variant="contained" onClick={() => void retry()}>
            {copy.unavailable.retry}
          </Button>
        }
      >
        {copy.unavailable.body}
      </Notice>
    </PlainPage>
  )
}

/**
 * Signed-in users only. Signed-out users go to the login screen with `next`, so they come back to
 * the same screen (after an expiry too). A blocked vendor sees the explanation here, in place.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  switch (session.status) {
    case 'loading':
      return <SessionLoading />
    case 'unavailable':
      return <Unavailable />
    case 'blocked':
      return <BlockedPage />
    case 'signedOut': {
      // After a deliberate sign-out the next login starts fresh; otherwise it returns to this screen.
      const target = session.signedOutByUser ? '/' : `${location.pathname}${location.search}${location.hash}`
      return <Navigate to={loginPath(target)} replace state={{ expired: session.expired }} />
    }
    case 'signedIn':
      return children ?? <Outlet />
  }
}

/** Signed-out users only (login, sign-up, ...). Signed-in users go to where they were headed, or Home. */
export function PublicOnly({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading') return <SessionLoading />
  if (session.status === 'signedIn') {
    return <Navigate to={nextFrom(location.search)} replace />
  }
  return children ?? <Outlet />
}

/**
 * Pages only the vendor's owner may open. Staff who open one by its address see a "not allowed"
 * page inside the frame, never the page itself, an empty list or a redirect.
 */
export function RequireRole({ role, children }: { role: Role; children?: ReactNode }) {
  const session = useSession()
  if (session.role !== role) {
    return (
      <Notice
        title={copy.forbidden.title}
        illustration="store"
        focus
        actions={
          <Button component={Link} to="/" variant="contained">
            {copy.goHome}
          </Button>
        }
      >
        {copy.forbidden.body}
      </Notice>
    )
  }
  return children ?? <Outlet />
}

type Arrival = 'unknown' | 'ask' | 'page'

/**
 * The pages emailed links open (verify email, set or reset a password, accept an invite). They work
 * whoever is signed in, but a seller who is signed in is asked first: the link may be for another
 * account, and the page must not mix two people. Decided once, on arrival: a login in another tab
 * while the page is open does not take it away.
 */
export function OpenLink({ children }: { children?: ReactNode }) {
  const session = useSession()
  const [arrival, setArrival] = useState<Arrival>('unknown')
  const [leaving, setLeaving] = useState(false)
  let mode = arrival
  if (mode === 'unknown' && session.status !== 'loading') mode = session.status === 'signedIn' ? 'ask' : 'page'
  if (mode === 'ask' && session.status !== 'signedIn') mode = 'page'
  // Remembered from the render that decided it (React's "state from the previous render" pattern).
  if (mode !== arrival) setArrival(mode)

  if (mode === 'unknown') return <SessionLoading />
  if (mode === 'page') return children ?? <Outlet />
  return (
    <PlainPage>
      <Notice
        title={copy.signedInLink.title}
        illustration="store"
        actions={
          <>
            <Button
              variant="contained"
              disabled={leaving}
              onClick={() => {
                setLeaving(true)
                void session.logout().finally(() => setLeaving(false))
              }}
            >
              {leaving ? copy.signedInLink.signingOut : copy.signedInLink.signOut}
            </Button>
            <Button component={Link} to="/" replace variant="outlined">
              {copy.signedInLink.stay}
            </Button>
          </>
        }
      >
        {copy.signedInLink.body(session.user?.email ?? '')}
      </Notice>
    </PlainPage>
  )
}
