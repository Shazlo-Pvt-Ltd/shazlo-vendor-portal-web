import { Box, CircularProgress } from '@mui/material'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { paths } from '../app/paths'
import { useSession } from './useSession'

function Checking() {
  return (
    <Box role="status" aria-label="Checking your session" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress size={28} aria-hidden="true" />
    </Box>
  )
}

// Signed-in pages. A temporary password must be changed before anything else.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, admin } = useSession()
  const location = useLocation()
  if (status === 'checking') return <Checking />
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
  if (status === 'signed_in') return <Navigate to={paths.home} replace />
  return <>{children}</>
}

export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : paths.home
}
