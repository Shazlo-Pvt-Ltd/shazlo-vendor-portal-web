import { Box, Card, Typography } from '@mui/material'
import { brand, neutral } from '@shazlo/ui'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'

export type HubRow = {
  key: string
  title: string
  body?: ReactNode
  // A plain status word ("To do"); omitted when there is nothing to do.
  status?: string
  icon: LucideIcon
} & ({ to: string } | { onClick: () => void })

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  width: '100%',
  minHeight: 64,
  px: { xs: 2, sm: 2.5 },
  py: 1.5,
  color: neutral.ink,
  textDecoration: 'none',
  textAlign: 'left',
  font: 'inherit',
  border: 0,
  bgcolor: 'transparent',
  cursor: 'pointer',
  '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(16, 60, 100, 0.05)' } },
  '&:focus-visible': { outline: `2px solid ${brand.navy}`, outlineOffset: -2 },
} as const

function RowBody({ row }: { row: HubRow }) {
  const Icon = row.icon
  return (
    <>
      <Box component="span" sx={{ display: 'flex', color: neutral.inkSecondary, flexShrink: 0 }}>
        <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
      </Box>
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="span" variant="body1" sx={{ display: 'block' }}>
          {row.title}
        </Typography>
        {row.body && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {row.body}
          </Typography>
        )}
      </Box>
      {row.status && (
        <Typography component="span" variant="body2" sx={{ flexShrink: 0, color: neutral.ink, whiteSpace: 'nowrap' }}>
          {row.status}
        </Typography>
      )}
      {'to' in row && (
        <Box component="span" sx={{ display: 'flex', color: neutral.inkSecondary, flexShrink: 0 }}>
          <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
        </Box>
      )}
    </>
  )
}

// A short list of places, one row each: the Store and Account pages.
export function HubList({ label, rows }: { label: string; rows: HubRow[] }) {
  return (
    <Card component="nav" aria-label={label} sx={{ overflow: 'hidden' }}>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((row, i) => (
          <Box component="li" key={row.key} sx={{ borderTop: i === 0 ? 0 : `1px solid ${neutral.line}` }}>
            {'to' in row ? (
              <Box component={RouterLink} to={row.to} sx={rowSx}>
                <RowBody row={row} />
              </Box>
            ) : (
              <Box component="button" type="button" onClick={row.onClick} sx={rowSx}>
                <RowBody row={row} />
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Card>
  )
}
