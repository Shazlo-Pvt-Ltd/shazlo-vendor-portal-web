import { Box, Typography } from '@mui/material'
import { usePageTitle } from '../hooks/usePageTitle'

/** Where an admin who must change their password is held. The form comes with the sign-in issue (issue 251). */
export function ChangePasswordPage() {
  usePageTitle('Change password')
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        Change your password
      </Typography>
      <Typography>You must choose a new password before you can continue. The form is not built yet.</Typography>
    </Box>
  )
}
