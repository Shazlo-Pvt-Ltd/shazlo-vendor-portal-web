import { Box, Skeleton, Stack } from '@mui/material'

// Shown while a page's code or first data loads: blocks shaped like a typical page.
export function PageFallback({ label = 'Loading' }: { label?: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true">
      <Skeleton variant="text" height={56} sx={{ width: 280, maxWidth: '100%' }} />
      <Skeleton variant="text" sx={{ width: 360, maxWidth: '100%' }} />
      <Stack direction="row" spacing={2} sx={{ mt: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={112} sx={{ flex: 1 }} />
        ))}
      </Stack>
      <Skeleton variant="rounded" height={320} sx={{ mt: 3 }} />
    </Box>
  )
}
