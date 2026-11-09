import { Box, Button, Link, Skeleton, Stack, Typography } from '@mui/material'
import { Banner, brand, EmptyState, neutral, SectionCard, StatFigure, StatusPill } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import type { components } from '../../api/vendor-admin'
import { homeCopy } from '../../copy/home'
import { formatCount, formatRelative } from '../../lib/format'
import { formatMinutes } from './time'

type Summary = components['schemas']['Summary']
type Decision = Summary['recent'][number]

const VENDORS = '/vendors'
export const vendorLinks = {
  queue: `${VENDORS}/queue`,
  publishing: `${VENDORS}/publishing`,
  brandReview: (vendorId: string) => `${VENDORS}/review/brand/${vendorId}`,
  vendor: (vendorId: string) => `${VENDORS}/vendors/${vendorId}`,
}

const touch = { minHeight: { xs: 44, md: 36 } }
const grid = { display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: { xs: 1.5, md: 2 } } as const

function FigureSkeletons({ label }: { label: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true" sx={grid}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="rounded" height={112} />
      ))}
    </Box>
  )
}

export function VendorsCard({ summary }: { summary: Summary | undefined }) {
  const copy = homeCopy.vendors
  return (
    <SectionCard
      title={copy.title}
      action={
        <Button variant="contained" component={RouterLink} to={vendorLinks.queue} sx={{ ...touch, whiteSpace: 'nowrap' }}>
          {copy.openQueue}
        </Button>
      }
    >
      {!summary ? (
        <FigureSkeletons label={copy.loading} />
      ) : (
        <Box aria-label={copy.label} role="group" sx={grid}>
          <StatFigure label={copy.waiting} value={formatCount(summary.queue.all)} baseline={copy.waitingBaseline(formatCount(summary.queue.product), formatCount(summary.queue.brand_page), formatCount(summary.queue.application))} />
          <StatFigure label={copy.over24h} value={formatCount(summary.queue.over_24h)} baseline={copy.over24hBaseline} />
          <StatFigure label={copy.decidedToday} value={formatCount(summary.decided_today)} baseline={copy.decidedTodayBaseline} />
          <StatFigure label={copy.median} value={formatMinutes(summary.median_minutes)} baseline={copy.medianBaseline} />
        </Box>
      )}
    </SectionCard>
  )
}

export function PublishingCard({ summary }: { summary: Summary | undefined }) {
  const copy = homeCopy.publishing
  const failed = summary?.publishing.failed ?? 0
  const open = (
    <Button variant="outlined" component={RouterLink} to={vendorLinks.publishing} sx={{ ...touch, whiteSpace: 'nowrap', bgcolor: 'background.paper' }}>
      {copy.open}
    </Button>
  )
  return (
    <SectionCard
      title={copy.title}
      action={
        failed === 0 && summary ? (
          <Link component={RouterLink} to={vendorLinks.publishing} variant="body2" sx={{ whiteSpace: 'nowrap', py: 1 }}>
            {copy.open}
          </Link>
        ) : undefined
      }
    >
      {!summary ? (
        <FigureSkeletons label={copy.loading} />
      ) : (
        <Stack spacing={2}>
          {failed > 0 && <Banner tone="warning" title={copy.failedTitle(failed)} action={open} />}
          <Box aria-label={copy.label} role="group" sx={grid}>
            <StatFigure label={copy.delivered} value={formatCount(summary.publishing.delivered_24h)} baseline={copy.deliveredBaseline} />
            <StatFigure label={copy.waiting} value={formatCount(summary.publishing.waiting)} baseline={copy.waitingBaseline} />
            <StatFigure label={copy.retrying} value={formatCount(summary.publishing.retrying)} baseline={copy.retryingBaseline} />
            <StatFigure label={copy.failed} value={formatCount(failed)} baseline={failed > 0 ? copy.failedBaseline : copy.failedBaselineNone} />
          </Box>
        </Stack>
      )}
    </SectionCard>
  )
}

// The summary gives decision ids, not the reviewed item's id. Brand pages and applications are keyed
// by vendor, so they open directly; a product decision opens the queue until the summary carries it.
function decisionHref(d: Decision): string {
  if (d.kind === 'brand_page') return vendorLinks.brandReview(d.vendor.id)
  if (d.kind === 'application') return vendorLinks.vendor(d.vendor.id)
  return vendorLinks.queue
}

const rowPadding = { px: { xs: 2, sm: 3 } }

function DecisionRow({ decision }: { decision: Decision }) {
  const copy = homeCopy.decisions
  const approved = decision.decision === 'approved'
  return (
    <Box
      component="li"
      sx={{
        ...rowPadding,
        position: 'relative',
        display: 'flex',
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
        gap: { xs: 1, sm: 2 },
        alignItems: 'flex-start',
        py: 1.75,
        borderTop: `1px solid ${neutral.line}`,
        '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(255, 237, 163, 0.35)' } },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 0 } }}>
        {/* The title link stretches over the row, so the whole row opens the item. */}
        <Link
          component={RouterLink}
          to={decisionHref(decision)}
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
          {decision.title}
        </Link>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
          {decision.vendor.name}
          <Box component="span" aria-hidden="true" sx={{ mx: 0.75 }}>
            ·
          </Box>
          {copy.kind[decision.kind] ?? decision.kind}
        </Typography>
      </Box>
      <Stack spacing={0.5} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-end' }, flexShrink: 0 }}>
        <StatusPill status={approved ? 'live' : 'sentBack'} label={approved ? copy.approved : copy.sentBack} />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {copy.by(decision.reviewer)}
          <Box component="span" aria-hidden="true" sx={{ mx: 0.5 }}>
            ·
          </Box>
          <time dateTime={decision.at}>{formatRelative(decision.at)}</time>
        </Typography>
      </Stack>
    </Box>
  )
}

export function RecentDecisions({ summary }: { summary: Summary | undefined }) {
  const copy = homeCopy.decisions
  let body
  if (!summary)
    body = (
      <Box role="status" aria-label={copy.loading} aria-busy="true" sx={{ pb: 1 }}>
        {[0, 1, 2].map((i) => (
          <Stack key={i} direction="row" spacing={2} sx={{ ...rowPadding, py: 1.75, borderTop: `1px solid ${neutral.line}` }}>
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="55%" />
              <Skeleton variant="text" width="30%" />
            </Box>
            <Skeleton variant="rounded" width={80} height={22} />
          </Stack>
        ))}
      </Box>
    )
  else if (summary.recent.length === 0) body = <EmptyState illustration="clock" title={copy.emptyTitle} body={copy.emptyBody} />
  else
    body = (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pb: 1 }}>
        {summary.recent.map((d) => (
          <DecisionRow key={d.id} decision={d} />
        ))}
      </Box>
    )
  return (
    <SectionCard title={copy.title} padded={false}>
      {body}
    </SectionCard>
  )
}

export function SummaryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Banner
      tone="error"
      title={homeCopy.vendors.error}
      action={
        <Button variant="outlined" sx={{ ...touch, bgcolor: 'background.paper' }} onClick={onRetry}>
          {homeCopy.retry}
        </Button>
      }
    >
      {message}
    </Banner>
  )
}
