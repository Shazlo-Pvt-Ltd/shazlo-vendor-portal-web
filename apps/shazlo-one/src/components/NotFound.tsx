import { Box, Button, Typography } from '@mui/material'
import { Link } from 'react-router'
import { usePageTitle } from '../hooks/usePageTitle'

/** "Nothing here." A page of its own, with one h1 and a way back. */
export function NotFound() {
  usePageTitle('Page not found')
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Page not found
      </Typography>
      <Typography sx={{ mb: 3 }}>There is nothing at this address. It may have moved.</Typography>
      <Button component={Link} to="/" variant="contained">
        Go to the start page
      </Button>
    </Box>
  )
}
