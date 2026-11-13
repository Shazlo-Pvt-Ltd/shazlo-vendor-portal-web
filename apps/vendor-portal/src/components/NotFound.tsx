import { Box, Button, Typography } from '@mui/material'
import { Link } from 'react-router'

export function NotFound() {
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Page not found
      </Typography>
      <Typography sx={{ mb: 3 }}>There is nothing at this address. It may have moved.</Typography>
      <Button component={Link} to="/" variant="contained">
        Go to the dashboard
      </Button>
    </Box>
  )
}
