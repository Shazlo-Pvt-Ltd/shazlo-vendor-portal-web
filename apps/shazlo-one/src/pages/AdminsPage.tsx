import { Alert, Box, Typography } from '@mui/material'
import { usePageTitle } from '../hooks/usePageTitle'

/** The admin management screens (super admins only, guarded in the routes). They arrive with their own issue. */
export function AdminsPage() {
  usePageTitle('Admins')
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        Admins
      </Typography>
      <Alert severity="info">Creating and managing admins is not built yet.</Alert>
    </Box>
  )
}
