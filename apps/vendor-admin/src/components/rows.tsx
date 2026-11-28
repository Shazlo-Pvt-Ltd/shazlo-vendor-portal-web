import { Box } from '@mui/material'
import { neutral } from '@shazlo/ui'
import { ChevronRight } from 'lucide-react'
import type { MouseEvent } from 'react'

// Keyboard focus on a row's or card's main link (data-stretch) rings the whole row or card.
export const focusRing = { outline: `2px solid ${neutral.inkSecondary}`, outlineOffset: -2 } as const

// A table row that is one link. The title's link carries data-stretch and stretchSx, so its cover
// spans the row: the whole row is the click target and the only tab stop, with no nested controls.
// Anything else in the row that can be pressed sits above the cover (aboveStretch).
export const linkRowSx = {
  position: 'relative',
  cursor: 'pointer',
  '@media (hover: hover)': {
    '&:hover': { bgcolor: 'action.hover' },
    '&:hover [data-chevron]': { color: neutral.ink },
  },
  '&:has([data-stretch]:focus-visible)': focusRing,
} as const

// A browser that cannot stretch the link over a table row still opens the item from a click
// anywhere on it. Clicks on the link itself, or on another control, are theirs to handle, and the
// second click of a double click opens nothing more.
export function onRowClick(open: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if (event.detail > 1) return
    if ((event.target as HTMLElement).closest('a, button, input, [role="menuitem"]')) return
    open()
  }
}

// The "opens" cue at the end of a clickable row or card. Decorative: the link says where it goes.
export function RowChevron() {
  return (
    <Box component="span" aria-hidden="true" data-chevron="" sx={{ display: 'inline-flex', color: neutral.inkSecondary, transition: 'color 120ms' }}>
      <ChevronRight size={20} strokeWidth={1.75} />
    </Box>
  )
}
