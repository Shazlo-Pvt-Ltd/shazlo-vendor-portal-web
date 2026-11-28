import { Box, Button, Typography } from '@mui/material'
import { Link } from 'react-router'
import { usePageTitle } from '../hooks/usePageTitle'

/**
 * "You don't have access" (a 403), shown in place of a page or module the admin's roles do not
 * allow. It never contains the thing it refuses: no module frame, no data.
 */
export function NoAccess({ what = 'page' }: { what?: 'page' | 'module' }) {
  usePageTitle("You don't have access")
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        You don't have access to this {what}
      </Typography>
      <Typography sx={{ mb: 3 }}>
        Your role does not allow it (error 403). Ask a super admin if you need to open it.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Go to the home page
      </Button>
    </Box>
  )
}
