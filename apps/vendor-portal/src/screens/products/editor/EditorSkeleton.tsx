import { Box, Card, Skeleton, Stack } from '@mui/material'
import type { ReactNode } from 'react'
import { productEditorCopy } from '../../../copy/productEditor'

export const columnsSx = (twoColumn: boolean) =>
  ({ display: 'grid', gap: 3, alignItems: 'start', gridTemplateColumns: twoColumn ? 'minmax(0, 2.15fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }) as const

function CardBones({ title, children }: { title: number; children: ReactNode }) {
  return (
    <Card>
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2.5, pb: 3 }}>
        <Skeleton variant="text" width={title} height={28} sx={{ mb: 1.5 }} />
        {children}
      </Box>
    </Card>
  )
}

// Loading state shaped like the editor: header, then the cards in their columns.
export function EditorSkeleton({ twoColumn }: { twoColumn: boolean }) {
  return (
    <Box role="status" aria-label={productEditorCopy.loading} aria-busy="true">
      <Skeleton variant="text" sx={{ width: 'min(440px, 80%)', height: 60 }} />
      <Skeleton variant="text" width={220} sx={{ mb: { xs: 3, md: 4 } }} />
      <Box sx={columnsSx(twoColumn)}>
        <Stack spacing={3}>
          <CardBones title={90}>
            <Stack direction="row" spacing={2} sx={{ overflow: 'hidden' }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="rounded" sx={{ width: 120, height: 150, flexShrink: 0 }} />
              ))}
            </Stack>
          </CardBones>
          <CardBones title={80}>
            <Stack spacing={2.5}>
              <Skeleton variant="rounded" height={56} />
              <Skeleton variant="rounded" height={120} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} variant="rounded" height={56} sx={{ flex: 1 }} />
                ))}
              </Stack>
            </Stack>
          </CardBones>
          <CardBones title={60}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Skeleton variant="rounded" height={56} sx={{ flex: 1 }} />
              <Skeleton variant="rounded" height={56} sx={{ flex: 1 }} />
              <Skeleton variant="rounded" height={104} sx={{ flex: 1.15 }} />
            </Stack>
          </CardBones>
        </Stack>
        <Stack spacing={3}>
          <CardBones title={130}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="text" width={`${80 - i * 15}%`} sx={{ mb: 1 }} />
            ))}
          </CardBones>
          <CardBones title={70}>
            <Skeleton variant="text" width="85%" />
          </CardBones>
        </Stack>
      </Box>
    </Box>
  )
}
