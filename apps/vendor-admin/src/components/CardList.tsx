import { Box, Card, LinearProgress, Skeleton, Stack } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { brand, neutral } from '@shazlo/ui'
import type { ReactNode } from 'react'

const SKELETON_CARDS = 4

// A table's rows as cards, for frames under 900 px: one column on phones, two side by side on
// tablets. Each card is a list item; its link (or button) stretches over the whole card.
export function CardList({ label, loading, fetching, updatingLabel, children }: { label: string; loading: boolean; fetching: boolean; updatingLabel: string; children: ReactNode }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: -8, left: 0, right: 0, height: 2, zIndex: 2 }}>{fetching && !loading && <LinearProgress aria-label={updatingLabel} sx={{ height: 2 }} />}</Box>
      <Box
        component="ul"
        aria-label={label}
        aria-busy={loading || undefined}
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' } }}
      >
        {loading
          ? Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Card component="li" key={i} sx={{ p: 2 }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Skeleton variant="rounded" width={40} height={40} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="70%" />
                    <Skeleton variant="text" width="40%" height={14} />
                  </Box>
                </Stack>
                <Skeleton variant="rounded" width={120} height={22} sx={{ mt: 1.5 }} />
              </Card>
            ))
          : children}
      </Box>
    </Box>
  )
}

// One card. Hover tints it; a keyboard focus on its main link rings the whole card.
export function ListCard({ selected = false, item, children }: { selected?: boolean; item?: string; children: ReactNode }) {
  return (
    <Card
      component="li"
      data-item={item}
      sx={{
        position: 'relative',
        p: 2,
        minWidth: 0,
        bgcolor: selected ? alpha(brand.cream, 0.55) : undefined,
        '@media (hover: hover)': { '&:hover': { bgcolor: selected ? alpha(brand.cream, 0.55) : alpha(brand.cream, 0.25) } },
        '&:has([data-stretch]:focus-visible)': { outline: `2px solid ${neutral.inkSecondary}`, outlineOffset: 2 },
      }}
    >
      {children}
    </Card>
  )
}

// On a card's main link or button (with data-stretch): it covers the card, so the whole card is
// the tap target, and the card shows its keyboard focus.
export const stretchSx = { '&::after': { content: '""', position: 'absolute', inset: 0, zIndex: 0 }, '&:focus-visible': { outline: 'none' } } as const

// Anything else a card holds that can be pressed sits above the stretched link.
export const aboveStretch = { position: 'relative', zIndex: 1 } as const
