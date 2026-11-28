import { Box, Button, CircularProgress } from '@mui/material'
import { EmptyState } from '@shazlo/ui'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { paths } from '../app/paths'
import { shellCopy } from '../copy/shell'
import { useSession } from './useSession'

function Checking() {
  return (
    <Box role="status" aria-label="Checking your session" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress size={28} aria-hidden="true" />
    </Box>
  )
}

// identity-api could not be reached while the page loaded. That is not "signed out": the refresh
// cookie may still be good, so the admin is offered another try rather than the sign-in form.
function Unavailable() {
  const { retry } = useSession()
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2 }}>
      <EmptyState illustration="sheet" title={shellCopy.unavailable.title} body={shellCopy.unavailable.body} action={<Button variant="contained" onClick={() => void retry()}>{shellCopy.unavailable.retry}</Button>} />
    </Box>
  )
}

// Signed-in pages. A temporary password must be changed before anything else.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, admin } = useSession()
  const location = useLocation()
  if (status === 'checking') return <Checking />
  if (status === 'unavailable') return <Unavailable />
  if (status === 'signed_out' || !admin) {
    const next = location.pathname + location.search
    return <Navigate to={next === '/' ? paths.signIn : `${paths.signIn}?next=${encodeURIComponent(next)}`} replace />
  }
  if (admin.must_change_password && location.pathname !== paths.changePassword) return <Navigate to={paths.changePassword} replace />
  return <>{children}</>
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useSession()
  if (status === 'checking') return <Checking />
  if (status === 'unavailable') return <Unavailable />
  if (status === 'signed_in') return <Navigate to={paths.home} replace />
  return <>{children}</>
}

export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : paths.home
}
