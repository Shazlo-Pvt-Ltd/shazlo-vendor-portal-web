import { Box, Button, Link, Stack, Typography } from '@mui/material'
import { useEffect } from 'react'
import { SUPPORT_EMAIL } from '../config/support'
import { useSession } from './AuthProvider'

/**
 * Shown for a vendor that is rejected or suspended. It explains and offers support; it never
 * redirects to login, which would loop (the account would be refused again).
 */
export function BlockedPage() {
  const { logout } = useSession()
  useEffect(() => {
    document.title = 'Account unavailable · Shazlo Vendor Portal'
  }, [])
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        This account can't use the portal
      </Typography>
      <Typography sx={{ mb: 2 }}>
        Your vendor account was rejected or suspended, so you can't sign in right now. Nothing you
        created has been deleted.
      </Typography>
      <Typography sx={{ mb: 3 }}>
        To find out why or to ask for a review, contact support at{' '}
        <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link>.
      </Typography>
      <Stack direction="row" spacing={2}>
        <Button variant="contained" component="a" href={`mailto:${SUPPORT_EMAIL}`}>
          Contact support
        </Button>
        <Button variant="outlined" onClick={() => void logout()}>
          Sign in with another account
        </Button>
      </Stack>
    </Box>
  )
}
