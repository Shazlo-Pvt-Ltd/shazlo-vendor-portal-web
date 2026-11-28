import { Box, Button, Link, Skeleton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import { Banner, brand, emphasis, EmptyState, neutral, SectionCard, StatFigure, StatusPill } from '@shazlo/ui'
import { ChevronRight, ClipboardCheck, Send, Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import type { HomeDecision, HomeSummary } from '../../api/summary'
import { homeCopy } from '../../copy/home'
import { formatCount, formatRelative } from '../../lib/format'
import { formatMinutes } from './time'

type Summary = HomeSummary
type Decision = HomeDecision
// The statuses the module's publishing page filters by (its `status` query parameter).
type PublishingStatus = 'delivered' | 'waiting' | 'retrying' | 'failed'

const VENDORS = '/vendors'
export const vendorLinks = {
  queue: `${VENDORS}/queue`,
  // The queue filters by "24–48 h" or "older than 48 h", not "over 24 h"; oldest first puts those on top.
  queueOldest: `${VENDORS}/queue?sort=oldest`,
  publishing: `${VENDORS}/publishing`,
  publishingStatus: (status: PublishingStatus) => `${VENDORS}/publishing?status=${status}`,
  brandReview: (vendorId: string) => `${VENDORS}/review/brand/${vendorId}`,
  vendor: (vendorId: string) => `${VENDORS}/vendors/${vendorId}`,
}

const touch = { minHeight: { xs: 44, md: 36 } }

// A banner's button sits beside its text; on a phone that leaves the text a narrow column, so the
// button moves under the text instead.
function usePhone() {
  const theme = useTheme()
  return useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
}
const actionBelow = (action: ReactNode) => <Box sx={{ mt: 1.25 }}>{action}</Box>
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
      icon={Store}
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
          <StatFigure label={copy.waiting} value={formatCount(summary.queue.all)} baseline={copy.waitingBaseline(formatCount(summary.queue.product), formatCount(summary.queue.brand_page), formatCount(summary.queue.application))} href={vendorLinks.queue} linkComponent={RouterLink} />
          <StatFigure label={copy.over24h} value={formatCount(summary.queue.over_24h)} baseline={copy.over24hBaseline} href={vendorLinks.queueOldest} linkComponent={RouterLink} />
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
  const phone = usePhone()
  const open = (
    <Button variant="outlined" component={RouterLink} to={vendorLinks.publishing} sx={{ ...touch, whiteSpace: 'nowrap', bgcolor: 'background.paper' }}>
      {copy.open}
    </Button>
  )
  return (
    <SectionCard
      title={copy.title}
      icon={Send}
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
          {failed > 0 && (phone ? <Banner tone="warning" title={copy.failedTitle(failed)}>{actionBelow(open)}</Banner> : <Banner tone="warning" title={copy.failedTitle(failed)} action={open} />)}
          <Box aria-label={copy.label} role="group" sx={grid}>
            <StatFigure label={copy.delivered} value={formatCount(summary.publishing.delivered_24h)} baseline={copy.deliveredBaseline} href={vendorLinks.publishingStatus('delivered')} linkComponent={RouterLink} />
            <StatFigure label={copy.waiting} value={formatCount(summary.publishing.waiting)} baseline={copy.waitingBaseline} href={vendorLinks.publishingStatus('waiting')} linkComponent={RouterLink} />
            <StatFigure label={copy.retrying} value={formatCount(summary.publishing.retrying)} baseline={copy.retryingBaseline} href={vendorLinks.publishingStatus('retrying')} linkComponent={RouterLink} />
            <StatFigure label={copy.failed} value={formatCount(failed)} baseline={failed > 0 ? copy.failedBaseline : copy.failedBaselineNone} href={vendorLinks.publishingStatus('failed')} linkComponent={RouterLink} />
          </Box>
        </Stack>
      )}
    </SectionCard>
  )
}

// Brand pages are keyed by vendor, and applications and commission decisions open the vendor, so they
// link directly. A product decision still opens the queue: the summary now carries the review id, but
// the module's review URLs are settled in #295, and the link follows them then.
function decisionHref(d: Decision): string {
  if (d.kind === 'brand_page') return vendorLinks.brandReview(d.vendor.id)
  if (d.kind === 'application' || d.kind === 'commission') return vendorLinks.vendor(d.vendor.id)
  return vendorLinks.queue
}

const rowPadding = { px: { xs: 2, sm: 3 } }
const chevron = 'decision-chevron'

// The whole row is one link (no other control inside it), so it opens from anywhere on the row and
// reads as one item: title, vendor and type, the decision, and who decided when.
function DecisionRow({ decision }: { decision: Decision }) {
  const copy = homeCopy.decisions
  const approved = decision.decision === 'approved'
  return (
    <Box component="li" sx={{ borderTop: `1px solid ${neutral.line}` }}>
      <Link
        component={RouterLink}
        to={decisionHref(decision)}
        underline="none"
        sx={{
          ...rowPadding,
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1, sm: 2 },
          py: 1.75,
          color: 'text.primary',
          cursor: 'pointer',
          // The card clips anything outside the row, so the ring sits just inside it.
          '&:focus-visible': { outline: `2px solid ${brand.navy}`, outlineOffset: -2 },
          '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' }, [`&:hover .${chevron}`]: { color: neutral.ink, transform: 'translateX(2px)' } },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: { xs: 'wrap', sm: 'nowrap' }, gap: { xs: 1, sm: 2 }, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 0 } }}>
            <Typography component="span" variant="body1" sx={{ display: 'block', ...emphasis.semibold, color: 'text.primary', overflowWrap: 'anywhere' }}>
              {decision.title}
            </Typography>
            <Typography component="span" variant="body2" color="textSecondary" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>
              {decision.vendor.name}
              <Box component="span" aria-hidden="true" sx={{ mx: 0.75 }}>
                ·
              </Box>
              {copy.kind[decision.kind] ?? decision.kind}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: { xs: 'flex-start', sm: 'flex-end' }, flexShrink: 0 }}>
            <StatusPill status={approved ? 'live' : 'sentBack'} label={approved ? copy.approved : copy.sentBack} />
            <Typography component="span" variant="caption" color="textSecondary" sx={{ whiteSpace: 'nowrap' }}>
              {copy.by(decision.reviewer)}
              <Box component="span" aria-hidden="true" sx={{ mx: 0.5 }}>
                ·
              </Box>
              <time dateTime={decision.at}>{formatRelative(decision.at)}</time>
            </Typography>
          </Box>
        </Box>
        <Box component="span" className={chevron} sx={{ display: 'flex', flexShrink: 0, color: neutral.inkSecondary, '@media (prefers-reduced-motion: no-preference)': { transition: 'transform 120ms ease-out, color 120ms ease-out' } }}>
          <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </Box>
      </Link>
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
    <SectionCard title={copy.title} icon={ClipboardCheck} padded={false}>
      {body}
    </SectionCard>
  )
}

export function SummaryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const phone = usePhone()
  const retry = (
    <Button variant="outlined" sx={{ ...touch, bgcolor: 'background.paper' }} onClick={onRetry}>
      {homeCopy.retry}
    </Button>
  )
  return (
    <Banner tone="error" title={homeCopy.vendors.error} action={phone ? undefined : retry}>
      {message}
      {phone && actionBelow(retry)}
    </Banner>
  )
}
