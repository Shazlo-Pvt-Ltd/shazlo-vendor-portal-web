import { Box, Typography } from '@mui/material'
import { usePageTitle } from '../hooks/usePageTitle'

/** The empty shell. Sign-in, the navigation and the modules are added by the issues that follow. */
export function HomePage() {
  usePageTitle('Home')
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 720, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        Shazlo-One
      </Typography>
      <Typography>The admin shell is being built. There is nothing to open yet.</Typography>
    </Box>
  )
}
