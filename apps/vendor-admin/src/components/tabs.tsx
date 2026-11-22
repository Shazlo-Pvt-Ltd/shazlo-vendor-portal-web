import { Box } from '@mui/material'
import { brand, neutral, radius } from '@shazlo/ui'
import { formatCount } from '../lib/format'
import { focusRing } from './rows'

// A row of tabs: a rule under it and a brown indicator under the chosen tab.
export const tabsSx = { borderBottom: `1px solid ${neutral.line}`, minHeight: 44, '& .MuiTabs-indicator': { bgcolor: brand.brown } } as const

// Each tab looks pressable: a pointer, and on hover a tint, ink text and a faint underline where
// the indicator would go; keyboard focus rings the tab inside the scroller, so it is never clipped.
export const tabSx = {
  minHeight: 44,
  px: 2,
  color: 'text.secondary',
  cursor: 'pointer',
  borderRadius: `${radius.control}px ${radius.control}px 0 0`,
  transition: 'background-color 120ms, color 120ms, box-shadow 120ms',
  '@media (hover: hover)': {
    '&:hover:not(.Mui-selected)': { bgcolor: 'action.hover', color: neutral.ink, boxShadow: `inset 0 -2px 0 ${neutral.lineStrong}` },
  },
  '&.Mui-selected': { color: neutral.ink },
  '&.Mui-focusVisible': focusRing,
} as const

// A tab's name and, once known, how many it holds.
export function TabLabel({ text, count }: { text: string; count?: number }) {
  return (
    <span>
      {text}
      {count != null && (
        <>
          {' '}
          <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', ml: 0.25 }}>
            {formatCount(count)}
          </Box>
        </>
      )}
    </span>
  )
}
