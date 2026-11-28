import { Box, Button, Card, IconButton, Link, Skeleton, Stack, Tooltip, Typography } from '@mui/material'
import { Banner, brand, EmptyState, neutral, radius, SectionCard } from '@shazlo/ui'
import { ArrowLeft, ChevronLeft, ChevronRight, History as HistoryIcon, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import type * as M from '../../api/model'
import { modulePaths } from '../../app/routes'
import { CardTitle } from '../../components/CardTitle'
import { reviewCopy as copy } from '../../copy/review'
import { formatStamp } from '../../lib/format'
import { touchIcon } from '../../lib/responsive'
import { formatWait } from '../../lib/status'
import type { Outcome } from './useDecision'

type History = M.History

// Where an item of the queue is reviewed: the review's id, on the page for its kind.
export function reviewPath(ref: M.ReviewRef): string {
  return ref.kind === 'brand_page' ? modulePaths.brand(ref.id) : modulePaths.product(ref.id)
}

export function newestFirst(history: History): History {
  return [...history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

// The person who submitted: the seller's owner, named on the latest submission.
export function submitterOf(history: History, fallback: string): string {
  return newestFirst(history).find((e) => e.event === 'submitted')?.by ?? fallback
}

// The latest decision, when it is newer than the latest submission.
export function lastDecision(history: History): History[number] | null {
  const latest = newestFirst(history)[0]
  return latest && (latest.event === 'approved' || latest.event === 'rejected' || latest.event === 'withdrawn') ? latest : null
}

export type Decided = 'approved' | 'rejected' | 'withdrawn'

// A review that is not waiting any more, whoever ended it; null while it waits.
export function decidedOf(status: M.ProductReview['status']): Decided | null {
  return status === 'pending_review' ? null : status
}

export function submittedLine(iso: string): string {
  // No-break spaces keep "5 h 26 m" on one line.
  return copy.submitted(formatStamp(iso), formatWait(Date.now() - Date.parse(iso)).replace(/ /g, '\u00a0'))
}

function NavButton({ to, label, empty, icon }: { to: M.ReviewRef | null; label: string; empty: string; icon: ReactNode }) {
  if (to) {
    return (
      <Tooltip title={label}>
        <IconButton component={RouterLink} to={reviewPath(to)} aria-label={label} sx={{ ...touchIcon, color: neutral.ink }}>
          {icon}
        </IconButton>
      </Tooltip>
    )
  }
  return (
    <Tooltip title={empty} describeChild>
      <Box component="span" sx={{ display: 'inline-flex' }}>
        <IconButton disabled aria-label={label} sx={touchIcon}>
          {icon}
        </IconButton>
      </Box>
    </Tooltip>
  )
}

// Back to the queue on the left; the previous and next items in the queue on the right.
export function QueueNav({ prev, next }: { prev: M.ReviewRef | null; next: M.ReviewRef | null }) {
  return (
    <Stack component="nav" aria-label={copy.nav.back} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2 }}>
      <Link component={RouterLink} to={modulePaths.queue} underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: neutral.inkSecondary, typography: 'body2', minHeight: { xs: 44, md: 36 } }}>
        <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        {copy.nav.back}
      </Link>
      <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
        <NavButton to={prev} label={copy.nav.prev} empty={copy.nav.noPrev} icon={<ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />} />
        <NavButton to={next} label={copy.nav.next} empty={copy.nav.noNext} icon={<ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />} />
      </Stack>
    </Stack>
  )
}

// Main column (~62%) and a sticky side column for the decision; one column below 900 px.
export function ReviewColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 62fr) minmax(0, 38fr)' }, gap: 3, alignItems: 'start' }}>
      <Stack spacing={3} sx={{ minWidth: 0 }}>
        {main}
      </Stack>
      <Stack spacing={3} sx={{ minWidth: 0, position: { md: 'sticky' }, top: { md: 24 } }}>
        {side}
      </Stack>
    </Box>
  )
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1, px: 1.5, py: 1.25, bgcolor: brand.cream, borderRadius: `${radius.card}px` }}>
      <Box component="span" sx={{ color: brand.brown, display: 'flex', pt: '2px', flexShrink: 0 }}>
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
      </Box>
      <Typography component="blockquote" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  )
}

export function HistoryCard({ history }: { history: History }) {
  const events = newestFirst(history)
  return (
    <SectionCard title={<CardTitle icon={HistoryIcon}>{copy.history.title}</CardTitle>}>
      {events.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          {copy.history.empty}
        </Typography>
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {events.map((e, i) => (
            <Box component="li" key={`${e.at}-${e.event}-${i}`} sx={{ position: 'relative', pl: 2.5, pb: i === events.length - 1 ? 0 : 2 }}>
              {/* The timeline: a dot per event on a thin line. */}
              <Box aria-hidden="true" sx={{ position: 'absolute', left: 3, top: 7, width: 7, height: 7, borderRadius: '50%', bgcolor: i === 0 ? brand.brown : neutral.lineStrong }} />
              {i < events.length - 1 && <Box aria-hidden="true" sx={{ position: 'absolute', left: 6, top: 18, bottom: 2, width: '1px', bgcolor: neutral.line }} />}
              <Typography variant="body2">
                {copy.history.event[e.event]} <b>{e.by}</b>
                <Box component="span" sx={{ color: neutral.inkSecondary }}>
                  {' · '}
                  {formatStamp(e.at)}
                </Box>
              </Typography>
              {e.note && <Quote>{e.note}</Quote>}
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  )
}

// The page's state after a decision: the reviewer's own outcome, or who decided before them.
export function OutcomeBanner({ decided, decision, history, next, seller, where }: { decided: Decided | null; decision: { outcome: Outcome | null; conflict: boolean }; history: History; next: M.ReviewRef | null; seller: string; where: 'product' | 'brand page' }) {
  const { outcome, conflict } = decision
  if (outcome) {
    return <DecidedBanner tone="success" title={outcome.decision === 'approved' ? copy.decided.approved : copy.decided.sentBack(seller, where)} next={outcome.next} />
  }
  if (decided) {
    const previous = lastDecision(history)
    const by = previous?.by ?? '—'
    const when = previous ? formatStamp(previous.at) : '—'
    const title = decided === 'approved' ? copy.decided.alreadyApproved(by, when) : decided === 'withdrawn' ? copy.decided.withdrawn(by, when) : copy.decided.alreadySentBack(by, when)
    const body = decided === 'withdrawn' ? copy.decided.withdrawnBody : conflict ? copy.decided.conflict : copy.decided.alreadyBody
    return <DecidedBanner tone="info" title={title} body={body} next={next} />
  }
  // Refused as stale but still waiting: the seller edited it, and what is on screen is the new version.
  return conflict ? <Banner tone="warning" title={copy.decided.changed} /> : null
}

function DecidedBanner({ tone, title, body, next }: { tone: 'success' | 'info'; title: string; body?: string; next: M.ReviewRef | null }) {
  return (
    <Banner
      tone={tone}
      title={title}
      action={
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {next && (
            <Button variant="contained" component={RouterLink} to={reviewPath(next)}>
              {copy.nextItem}
            </Button>
          )}
          <Button variant="outlined" component={RouterLink} to={modulePaths.queue}>
            {copy.backToQueue}
          </Button>
        </Stack>
      }
    >
      {body}
    </Banner>
  )
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Banner
      tone="error"
      title={copy.loadError}
      action={
        <Button variant="outlined" onClick={onRetry}>
          {copy.retry}
        </Button>
      }
    />
  )
}

export function NotFound({ title, body }: { title: string; body: string }) {
  return (
    <EmptyState
      illustration="box"
      title={title}
      body={body}
      action={
        <Button variant="contained" component={RouterLink} to={modulePaths.queue}>
          {copy.backToQueue}
        </Button>
      }
    />
  )
}

// Shaped like the page: top row, title, a tall main column and the decision column.
export function ReviewSkeleton() {
  return (
    <Box role="status" aria-label={copy.loading} aria-busy="true">
      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Skeleton variant="text" width={110} />
        <Skeleton variant="rounded" width={80} height={36} />
      </Stack>
      <Skeleton variant="text" height={56} sx={{ width: { xs: '80%', md: '45%' } }} />
      <Skeleton variant="text" width="35%" sx={{ mb: 4 }} />
      <ReviewColumns
        main={
          <>
            <Card sx={{ p: 3 }}>
              <Skeleton variant="text" width={120} height={28} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1.5 }}>
                <Skeleton variant="rounded" height={375} sx={{ width: 300, maxWidth: '100%' }} />
                <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1.5}>
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} variant="rounded" width={72} height={90} />
                  ))}
                </Stack>
              </Stack>
            </Card>
            <Card sx={{ p: 3 }}>
              <Skeleton variant="text" width={220} height={28} />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} variant="text" />
              ))}
            </Card>
          </>
        }
        side={
          <Card sx={{ p: 3 }}>
            <Skeleton variant="text" width={160} height={28} />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="text" width="85%" />
            ))}
            <Skeleton variant="rounded" height={40} sx={{ mt: 2 }} />
          </Card>
        }
      />
    </Box>
  )
}
