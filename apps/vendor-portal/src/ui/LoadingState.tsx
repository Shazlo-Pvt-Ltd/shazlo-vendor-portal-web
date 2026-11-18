import { Box, CircularProgress, Skeleton, Stack, Typography } from '@mui/material'

/** Something is loading. Announced politely; the spinner itself is hidden from screen readers. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <Box role="status" aria-live="polite" aria-busy="true" sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
      <CircularProgress size={24} aria-hidden="true" />
      <Typography>{label}</Typography>
    </Box>
  )
}

/** The shape of a page while its code loads: a title bar and a few blocks. */
export function PageSkeleton() {
  return (
    <Box role="status" aria-live="polite" aria-busy="true" aria-label="Loading the page">
      <Skeleton variant="text" width="40%" sx={{ fontSize: '2rem' }} />
      <Stack spacing={2} sx={{ mt: 2 }}>
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={96} />
      </Stack>
    </Box>
  )
}
