import { Box, Typography } from '@mui/material'
import { usePageTitle } from '../hooks/usePageTitle'

/** The empty shell. Sign-in, the module registry and navigation arrive in the next Phase 6 issues. */
export function StartPage() {
  usePageTitle('Shazlo One')
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 640, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Shazlo One
      </Typography>
      <Typography>The admin shell is starting up. Nothing is here yet.</Typography>
    </Box>
  )
}
