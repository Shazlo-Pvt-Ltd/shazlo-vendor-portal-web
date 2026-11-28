import { useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'

// Breakpoints are the module frame's width, not the window's: beside the shell's sidebar a 1,024 px
// laptop gives the module about 770 px.

// Below 900 px the lists are cards: the tables need about 900 px to read without sideways scroll.
export const useCompact = () => useMediaQuery((theme: Theme) => theme.breakpoints.down('md'), { noSsr: true })

// Below 600 px: phones.
export const usePhone = () => useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'), { noSsr: true })

// A header action: the full width on phones, its own width from 600 px.
export const phoneFullWidth = { width: { xs: '100%', sm: 'auto' } } as const

// Icon buttons reach 44 px on touch-sized frames; desktop keeps MUI's own size.
export const touchIcon = { minWidth: { xs: 44, md: 0 }, minHeight: { xs: 44, md: 0 } } as const

// Tabs that scroll sideways on a phone, with the arrows shown there too.
export const scrollingTabs = { variant: 'scrollable', scrollButtons: 'auto', allowScrollButtonsMobile: true } as const

// Stat figures: four across from 900 px, two by two below, stacked on a frame too narrow for two.
// The figures step down to 24 px where two share a small phone, so "5 h 20 m" stays on one line.
export const statGrid = {
  display: 'grid',
  gap: { xs: 1.5, sm: 2 },
  gridTemplateColumns: { xs: 'repeat(auto-fit, minmax(min(132px, 100%), 1fr))', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
  '@media (max-width: 379.95px)': { '& .MuiTypography-stat': { fontSize: '1.5rem', lineHeight: 1.25 } },
} as const

// A filter row: on phones a two-column grid (search and switches take a whole row), from 600 px a
// wrapping row as before. Fields reach 44 px on phones.
export const filterBar = {
  display: { xs: 'grid', sm: 'flex' },
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 0 } },
} as const
export const fullRow = { gridColumn: '1 / -1' } as const
export const filterSpacer = { flex: 1, display: { xs: 'none', sm: 'block' } } as const
