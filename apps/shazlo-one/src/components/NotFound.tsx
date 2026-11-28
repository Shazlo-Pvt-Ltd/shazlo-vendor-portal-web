import { Box, Button, Typography } from '@mui/material'
import { Link } from 'react-router'
import { usePageTitle } from '../hooks/usePageTitle'

/** "Nothing here." Inside the signed-in shell (`embedded`) it is just the page; alone it is a page. */
export function NotFound({ embedded = false }: { embedded?: boolean }) {
  // Inside the shell the previous page's title would otherwise stay, naming a page that is not shown.
  usePageTitle('Page not found')
  return (
    <Box component={embedded ? 'div' : 'main'} sx={embedded ? {} : { p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        Page not found
      </Typography>
      <Typography sx={{ mb: 3 }}>There is nothing at this address. It may have moved.</Typography>
      <Button component={Link} to="/" variant="contained">
        Go to the home page
      </Button>
    </Box>
  )
}
