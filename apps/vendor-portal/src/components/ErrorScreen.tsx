import { Box, Button, Stack, Typography } from '@mui/material'

interface Props {
  onRetry?: () => void
}

/** What a vendor sees when something broke: no details, a way to try again, a way out. */
export function ErrorScreen({ onRetry }: Props) {
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 560, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Something went wrong
      </Typography>
      <Typography sx={{ mb: 3 }}>
        The page could not be shown. Nothing you saved was lost. Try again, or reload the page.
      </Typography>
      <Stack direction="row" spacing={2}>
        {onRetry ? (
          <Button variant="contained" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button variant="outlined" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </Stack>
    </Box>
  )
}
