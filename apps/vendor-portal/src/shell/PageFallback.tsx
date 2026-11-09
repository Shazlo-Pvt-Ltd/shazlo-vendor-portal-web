import { Box, Skeleton, Stack } from '@mui/material'

// Shown while a page's code or first data loads: blocks shaped like a typical page.
export function PageFallback({ label = 'Loading' }: { label?: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true">
      <Skeleton variant="text" width={280} height={56} />
      <Skeleton variant="text" width={360} />
      <Stack direction="row" spacing={2} sx={{ mt: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={112} sx={{ flex: 1 }} />
        ))}
      </Stack>
      <Skeleton variant="rounded" height={320} sx={{ mt: 3 }} />
    </Box>
  )
}
