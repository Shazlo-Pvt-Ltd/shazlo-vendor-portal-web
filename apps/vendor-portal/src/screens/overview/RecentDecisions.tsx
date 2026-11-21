import { Box, Button, Link, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { Banner, brand, EmptyState, neutral, SectionCard, StatusPill } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../api/client'
import { useReviews } from '../../api/queries'
import { paths } from '../../app/paths'
import { ProductThumb } from '../../components/ProductThumb'
import { overviewCopy } from '../../copy/overview'
import { formatRelative } from '../../lib/format'
import { reviewPill } from '../../lib/status'
import { subjectHref } from '../review/items'

const copy = overviewCopy.decisions
const SHOWN = 5
const rowPadding = { px: { xs: 2, sm: 3 } }

// On phones the pill and time sit under the title, so the text keeps the row's width.
function DecisionRow({ item, compact }: { item: Schemas['ReviewItem']; compact: boolean }) {
  const isProduct = item.subject.type === 'product'
  const status = (
    <Stack direction={compact ? 'row' : 'column'} spacing={compact ? 1 : 0.75} sx={{ alignItems: compact ? 'center' : 'flex-end', flexShrink: 0 }}>
      <StatusPill status={reviewPill(item)} />
      {item.decided_at && (
        <Typography variant="caption" color="text.secondary" component="time" dateTime={item.decided_at} sx={{ whiteSpace: 'nowrap' }}>
          {formatRelative(item.decided_at)}
        </Typography>
      )}
    </Stack>
  )
  return (
    <Box
      component="li"
      sx={{
        ...rowPadding,
        position: 'relative',
        display: 'flex',
        gap: 2,
        alignItems: 'flex-start',
        py: 1.75,
        borderTop: `1px solid ${neutral.line}`,
        '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(255, 237, 163, 0.35)' } },
      }}
    >
      <ProductThumb src={item.subject.thumbnail_url} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* The title link stretches over the row, so the whole row opens the item. */}
        <Link
          component={RouterLink}
          to={subjectHref(item)}
          variant="body1"
          underline="hover"
          sx={{
            display: 'block',
            color: neutral.ink,
            overflowWrap: 'anywhere',
            '&::after': { content: '""', position: 'absolute', inset: 0 },
            '&:focus-visible': { outline: 'none' },
            '&:focus-visible::after': { outline: `2px solid ${brand.navy}`, outlineOffset: -2 },
          }}
        >
          {item.subject.title}
        </Link>
        {isProduct && item.subject.detail && (
          <Typography variant="mono" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
            {item.subject.detail}
          </Typography>
        )}
        {compact && <Box sx={{ mt: 0.75 }}>{status}</Box>}
        {item.state === 'rejected' && item.reason && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: '65ch' }}>
            {copy.reason(item.reason)}
          </Typography>
        )}
      </Box>
      {!compact && status}
    </Box>
  )
}

function RowsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true" sx={{ pb: 1 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={2} sx={{ ...rowPadding, py: 1.75, borderTop: `1px solid ${neutral.line}` }}>
          <Skeleton variant="rounded" width={40} height={50} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="55%" />
            <Skeleton variant="text" width="30%" />
          </Box>
          <Skeleton variant="rounded" width={72} height={22} />
        </Stack>
      ))}
    </Box>
  )
}

// The latest few decisions; the full history is on Review status.
export function RecentDecisions() {
  const compact = !useMediaQuery((t: Theme) => t.breakpoints.up('md'), { noSsr: true })
  const reviews = useReviews(undefined, 20)
  const decided = (reviews.data?.items ?? []).filter((r) => r.state !== 'waiting' && r.decided_at).slice(0, SHOWN)

  let body
  if (reviews.isPending) body = <RowsSkeleton label={copy.loading} />
  else if (reviews.isError)
    body = (
      <Box sx={{ ...rowPadding, pb: 3 }}>
        <Banner tone="error" title={copy.error} action={<Button variant="outlined" sx={{ minHeight: { xs: 44, md: 36 } }} onClick={() => void reviews.refetch()}>{overviewCopy.retry}</Button>} />
      </Box>
    )
  else if (decided.length === 0)
    body = (
      <EmptyState
        illustration="clock"
        title={copy.emptyTitle}
        body={copy.emptyBody}
        tip={copy.emptyTip}
        action={
          <Button variant="outlined" component={RouterLink} to={paths.newProduct} sx={{ minHeight: { xs: 44, md: 36 } }}>
            {overviewCopy.addProduct}
          </Button>
        }
      />
    )
  else
    body = (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pb: 1 }}>
        {decided.map((item) => (
          <DecisionRow key={item.id} item={item} compact={compact} />
        ))}
      </Box>
    )

  return (
    <SectionCard
      title={copy.title}
      padded={false}
      action={
        <Link component={RouterLink} to={paths.review} aria-label={copy.viewAllLabel} variant="body2" sx={{ whiteSpace: 'nowrap', py: 1 }}>
          {copy.viewAll}
        </Link>
      }
    >
      {body}
    </SectionCard>
  )
}
