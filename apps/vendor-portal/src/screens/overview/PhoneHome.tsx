import { Box, Button, Card, Link, Skeleton, Stack, Typography } from '@mui/material'
import { Banner, brand, neutral, PageHeader, SectionCard } from '@shazlo/ui'
import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { useMe, useReviews, useSummary } from '../../api/queries'
import { paths } from '../../app/paths'
import { overviewCopy } from '../../copy/overview'
import { formatCount } from '../../lib/format'
import { setupSteps } from '../../shell/setup'
import { subjectHref } from '../review/items'

const copy = overviewCopy.home
const SHOWN = 3

const rowLinkSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  minHeight: 52,
  px: 2,
  py: 1,
  color: neutral.ink,
  textDecoration: 'none',
  '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(16, 60, 100, 0.05)' } },
  '&:focus-visible': { outline: `2px solid ${brand.navy}`, outlineOffset: -2 },
} as const

function Retry({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Banner tone="error" title={title}>
      <Button variant="outlined" sx={{ mt: 1.5, minHeight: 44 }} onClick={onRetry}>
        {overviewCopy.retry}
      </Button>
    </Banner>
  )
}

// One card, one yellow button: the first unfinished setup task, otherwise "Add product".
export function NextStep() {
  const me = useMe()
  const id = useId()
  if (me.isPending) return <Skeleton variant="rounded" height={176} role="status" aria-label={copy.next.loading} />
  if (me.isError) return <Retry title={copy.next.error} onRetry={() => void me.refetch()} />
  const next = setupSteps(me.data.setup).find((s) => !s.done)
  const text = next ? copy.next[next.key] : copy.next.add_product
  const to = next ? next.to : paths.newProduct
  return (
    <Card component="section" aria-labelledby={id} sx={{ p: 2.5 }}>
      <Typography id={id} variant="body2" component="h2" color="text.secondary">
        {copy.next.title}
      </Typography>
      <Typography variant="h1" component="p" sx={{ mt: 0.75 }}>
        {text.title}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 0.75 }}>
        {text.body}
      </Typography>
      <Button variant="contained" fullWidth component={RouterLink} to={to} sx={{ mt: 2.5, minHeight: 48 }}>
        {text.action}
      </Button>
    </Card>
  )
}

function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Box component="ul" aria-label={label} sx={{ listStyle: 'none', m: 0, p: 0, '& > li + li': { borderTop: `1px solid ${neutral.line}` } }}>
      {children}
    </Box>
  )
}

// The setup tasks with a plain status word each, until all are done. Each link is named by its
// visible text ("Store details To do"), so voice control users can say what they see.
export function SetupTasks() {
  const me = useMe().data
  if (!me) return null
  const steps = setupSteps(me.setup)
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  return (
    <SectionCard
      title={copy.tasks.title}
      padded={false}
      action={
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {copy.tasks.progress(done, steps.length)}
        </Typography>
      }
    >
      <Rows>
        {steps.map((step) => (
          <li key={step.key}>
            <Box component={RouterLink} to={step.to} sx={rowLinkSx}>
              <Typography component="span" variant="body1" sx={{ flex: 1, minWidth: 0 }}>
                {copy.tasks.labels[step.key]}
              </Typography>{' '}
              <Typography component="span" variant="body2" sx={{ color: step.done ? neutral.inkSecondary : neutral.ink, whiteSpace: 'nowrap' }}>
                {step.done ? copy.tasks.done : copy.tasks.todo}
              </Typography>
              <ChevronRight size={18} strokeWidth={1.5} color={neutral.inkSecondary} aria-hidden="true" />
            </Box>
          </li>
        ))}
      </Rows>
    </SectionCard>
  )
}

// Items the review team sent back, each with the reason in their words and a way to fix it.
export function NeedsChanges() {
  const reviews = useReviews('rejected')
  if (reviews.isPending) return <Skeleton variant="rounded" height={120} role="status" aria-label={copy.changes.loading} />
  if (reviews.isError) return <Retry title={copy.changes.error} onRetry={() => void reviews.refetch()} />
  const items = reviews.data.items
  if (items.length === 0) return null
  return (
    <SectionCard
      title={copy.changes.title}
      padded={false}
      action={
        items.length > SHOWN ? (
          <Link component={RouterLink} to={`${paths.review}?tab=rejected`} variant="body2" sx={{ whiteSpace: 'nowrap', py: 1 }}>
            {copy.changes.seeAll(items.length)}
          </Link>
        ) : undefined
      }
    >
      <Rows>
        {items.slice(0, SHOWN).map((item) => {
          const title = item.subject.type === 'brand_page' ? copy.changes.brandPage : item.subject.title
          return (
            <Box component="li" key={item.id} sx={{ px: 2, py: 1.75 }}>
              <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
                {title}
              </Typography>
              {item.reason && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {item.reason}
                </Typography>
              )}
              <Link component={RouterLink} to={subjectHref(item)} aria-label={copy.changes.fixLabel(title)} variant="body1" sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, mt: 0.25 }}>
                {copy.changes.fix}
              </Link>
            </Box>
          )
        })}
      </Rows>
    </SectionCard>
  )
}

const COUNTS = ['approved', 'pending_review', 'draft'] as const

// Counts as quiet rows, each opening Products on that status. Real zeros are printed.
export function ProductCounts() {
  const summary = useSummary()
  const id = useId()
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography id={id} variant="h2" sx={{ mb: 1 }}>
        {copy.counts.title}
      </Typography>
      {summary.isPending ? (
        <Skeleton variant="rounded" height={156} role="status" aria-label={copy.counts.loading} />
      ) : summary.isError ? (
        <Retry title={overviewCopy.stats.error} onRetry={() => void summary.refetch()} />
      ) : (
        <Card>
          <Rows>
            {COUNTS.map((status) => (
              <li key={status}>
                <Box component={RouterLink} to={`${paths.products}?status=${status}`} sx={rowLinkSx}>
                  <Typography component="span" variant="body1" sx={{ flex: 1 }}>
                    {copy.counts.rows[status]}
                  </Typography>{' '}
                  <Typography component="span" variant="body1" sx={{ fontVariantNumeric: 'lining-nums tabular-nums' }}>
                    {formatCount(summary.data.products[status])}
                  </Typography>
                  <ChevronRight size={18} strokeWidth={1.5} color={neutral.inkSecondary} aria-hidden="true" />
                </Box>
              </li>
            ))}
          </Rows>
        </Card>
      )}
    </Box>
  )
}

function Subtitle() {
  const me = useMe()
  if (me.isPending) return <Skeleton variant="text" width={160} sx={{ display: 'inline-block', maxWidth: '100%' }} />
  return me.data?.vendor.brand_name ?? null
}

// V-04 on phones (spec §4): what to do next, the setup tasks, what needs changes, then the numbers.
// No figures grid, no banners: Review status is one link away.
export function PhoneHome() {
  return (
    <>
      <PageHeader title={copy.title} subtitle={<Subtitle />} />
      <Stack spacing={3}>
        <NextStep />
        <SetupTasks />
        <NeedsChanges />
        <ProductCounts />
        <Link component={RouterLink} to={paths.review} variant="body1" sx={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
          {copy.seeAllDecisions}
        </Link>
      </Stack>
    </>
  )
}
