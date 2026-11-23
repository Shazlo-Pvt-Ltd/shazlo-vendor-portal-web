import { Box, Typography } from '@mui/material'
import { usePageTitle } from '../hooks/usePageTitle'

/** The place the guards send signed-out admins to. The form comes with the sign-in issue (issue 251). */
export function LoginPage() {
  usePageTitle('Sign in')
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        Sign in
      </Typography>
      <Typography>The sign-in form is not built yet.</Typography>
    </Box>
  )
}
