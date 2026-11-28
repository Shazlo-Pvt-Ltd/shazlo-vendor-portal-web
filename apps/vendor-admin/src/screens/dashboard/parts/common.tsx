import { Box, Button, Link, Skeleton, Stack } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { Banner, neutral } from '@shazlo/ui'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { focusRing, linkRowSx } from '../../../components/rows'
import { dashboardCopy } from '../../../copy/dashboard'
import { statGrid, usePhone } from '../../../lib/responsive'

// Buttons and links reach 44 px on touch-sized frames.
export const touch = { minHeight: { xs: 44, md: 36 } } as const

// Two figures a row on phones and tablets, four from 900 px. statGrid's smaller figures on a very
// narrow phone stay.
export const figureGrid = { ...statGrid, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } } as const

// Inside a card without padding, rows and banners line up with the card's title.
export const inset = { px: { xs: 2, sm: 3 } } as const

// The module's link-row look (rows.tsx): the pointer, and a tint and a darker chevron on hover.
// Not its stretched-link parts: here the row itself is the link, so it needs no cover to position
// and takes the focus ring on itself.
const { position: _position, '&:has([data-stretch]:focus-visible)': _stretchFocus, ...rowLook } = linkRowSx

// A row that is one link: it opens from anywhere on it, and shows a tint and a darker chevron on
// hover and a ring on keyboard focus.
export const rowLinkSx = {
  ...rowLook,
  ...inset,
  display: 'flex',
  alignItems: 'center',
  gap: { xs: 1, sm: 2 },
  py: 1.5,
  minHeight: 64,
  color: 'inherit',
  '&:focus-visible': focusRing,
} as const

export const rowSx = { borderTop: `1px solid ${neutral.line}` } as const

// A small link beside a card's title or under its rows.
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link component={RouterLink} to={to} variant="body2" sx={{ ...touch, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {children}
    </Link>
  )
}

export function FigureSkeletons({ label }: { label: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true" sx={figureGrid}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="rounded" height={112} />
      ))}
    </Box>
  )
}

export function RowSkeletons({ label }: { label: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Stack key={i} direction="row" spacing={2} sx={{ ...inset, ...rowSx, py: 1.75, alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" width="55%" />
            <Skeleton variant="text" width="35%" />
          </Box>
          <Skeleton variant="rounded" width={80} height={22} />
        </Stack>
      ))}
    </Box>
  )
}

// A banner whose button sits beside its text, or under it on a phone so the text keeps its width.
export function ActionBanner({ tone, title, action, children }: { tone: 'warning' | 'error'; title: string; action: ReactNode; children?: ReactNode }) {
  const phone = usePhone()
  return (
    <Box data-layout={phone ? 'stacked' : 'inline'}>
      <Banner tone={tone} title={title} action={phone ? undefined : action}>
        {children}
        {phone && <Box sx={{ mt: 1.25 }}>{action}</Box>}
      </Banner>
    </Box>
  )
}

export const bannerButtonSx = { ...touch, whiteSpace: 'nowrap', bgcolor: 'background.paper' } as const

type QueryState = { isPending: boolean; isError: boolean; isFetching: boolean; error: Error | null; refetch: () => unknown }

// One card's data: its own skeleton while it loads and its own error with a retry, so one failed
// request never blanks the rest of the page. A failed refetch keeps the last data under the banner.
// Several cards can fail at once, so each retry button is named after what it loads (`subject`):
// "Try again to load vendor figures", still starting with the words it shows.
export function Loaded<T>({ query, data, subject, errorTitle, skeleton, bannerSx, children }: { query: QueryState; data: T | undefined; subject: string; errorTitle: string; skeleton: ReactNode; bannerSx?: SxProps<Theme>; children: (data: T) => ReactNode }) {
  let body: ReactNode = null
  if (data !== undefined) body = children(data)
  else if (query.isPending) body = skeleton
  if (!query.isError) return body
  return (
    <Stack spacing={2}>
      <Box sx={bannerSx}>
        <ActionBanner
          tone="error"
          title={errorTitle}
          action={
            <Button variant="outlined" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label={dashboardCopy.retryLabel(subject)} sx={bannerButtonSx}>
              {dashboardCopy.retry}
            </Button>
          }
        >
          {query.error?.message}
        </ActionBanner>
      </Box>
      {body !== null && <Box>{body}</Box>}
    </Stack>
  )
}
