import { Box, Button, Stack, Tab, Tabs, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { Banner, brand, EmptyState, neutral, PageHeader } from '@shazlo/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router'
import type { Schemas } from '../../api/model'
import { useReviews, useSummary } from '../../api/queries'
import { paths } from '../../app/paths'
import { reviewCopy as copy } from '../../copy/review'
import { srOnly } from '../../lib/a11y'
import { formatCount } from '../../lib/format'
import { useSession } from '../../session/AuthProvider'
import { HowReviewWorks } from './HowReviewWorks'
import { endVisit, previousVisit } from './lastVisit'
import { DecidedCard, ListsSkeleton, WaitingCard } from './ReviewLists'
import { REFRESH_MS, sinceOf, statusChanges } from './rules'

const TABS = ['all', 'waiting', 'rejected', 'approved'] as const
type TabKey = (typeof TABS)[number]
const isTab = (value: string | null): value is TabKey => TABS.includes(value as TabKey)

const touch = { minHeight: { xs: 44, md: 36 } }

type ReviewState = Schemas['ReviewItem']['state']

function TabLabel({ text, count }: { text: string; count: number | undefined }) {
  return (
    <span>
      {text}
      {count != null && (
        <>
          {' '}
          <Box component="span" sx={{ color: neutral.inkSecondary, fontVariantNumeric: 'tabular-nums' }}>
            {formatCount(count)}
          </Box>
        </>
      )}
    </span>
  )
}

// V-09: what is in the queue, what was decided, and how review works.
export default function ReviewStatus() {
  const desktop = useMediaQuery((t: Theme) => t.breakpoints.up('md'), { noSsr: true })
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: TabKey = isTab(requested) ? requested : 'all'
  const reviews = useReviews()
  const oldest = useSummary().data?.oldest_waiting_hours ?? null
  const id = useId()
  const lastLoginAt = useSession().user?.last_login_at

  // Main's "new since your last visit": decisions after the previous visit in this tab (or, on the
  // first one, after signing in) are marked. Leaving the page records this visit.
  const [since] = useState(() => sinceOf(previousVisit(), lastLoginAt))
  useEffect(() => () => endVisit(), [])

  // Decisions arrive while the page is open: ask every minute (and when the window regains focus).
  const refetch = useRef(reviews.refetch)
  useEffect(() => {
    refetch.current = reviews.refetch
  })
  useEffect(() => {
    const timer = window.setInterval(() => void refetch.current(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  // A decision that arrives while the seller watches is read out, not only redrawn.
  const seen = useRef(new Map<string, ReviewState>())
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const now = reviews.data?.items
    if (!now) return
    const changes = statusChanges(seen.current, now)
    if (changes.length > 0) setAnnouncement(copy.announce.updated(changes.join(' ')))
    for (const item of now) seen.current.set(item.id, item.state)
  }, [reviews.data])

  const select = (next: TabKey) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('tab')
        else p.set('tab', next)
        return p
      },
      { replace: true },
    )

  const counts = reviews.data?.counts
  const nothingYet = counts?.all === 0
  const items = reviews.data?.items ?? []
  const waiting = items.filter((r) => r.state === 'waiting')
  const decided = items.filter((r) => r.state !== 'waiting' && (tab === 'all' || r.state === tab))

  let panel
  if (reviews.isPending) panel = <ListsSkeleton />
  else if (reviews.isError)
    panel = (
      <Banner
        tone="error"
        title={copy.error}
        action={
          <Button variant="outlined" sx={touch} onClick={() => void reviews.refetch()}>
            {copy.retry}
          </Button>
        }
      />
    )
  else
    panel = (
      <Stack spacing={{ xs: 2.5, md: 3 }}>
        {tab !== 'rejected' && tab !== 'approved' && <WaitingCard items={waiting} total={counts?.waiting ?? waiting.length} compact={!desktop} />}
        {tab !== 'waiting' && <DecidedCard items={decided} all={items} since={since} filter={tab} compact={!desktop} />}
      </Stack>
    )

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <Stack spacing={{ xs: 2.5, md: 3 }}>
        <Banner tone="info" title={oldest == null ? copy.queue : `${copy.queue} ${copy.oldest(oldest)}`} />
        <Box sx={{ display: 'grid', gridTemplateColumns: desktop ? 'minmax(0, 2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: { xs: 2.5, md: 3 }, alignItems: 'start' }}>
          <Box sx={{ minWidth: 0 }}>
            {nothingYet ? (
              <EmptyState
                illustration="clock"
                title={copy.nothing.title}
                body={copy.nothing.body}
                tip={copy.nothing.tip}
                action={
                  <Button variant="contained" component={RouterLink} to={paths.newProduct} sx={touch}>
                    {copy.addProduct}
                  </Button>
                }
              />
            ) : (
              <>
                <Tabs
                  value={tab}
                  onChange={(_, next: TabKey) => select(next)}
                  aria-label={copy.tabsLabel}
                  variant="scrollable"
                  scrollButtons={false}
                  sx={{
                    mb: { xs: 2, md: 2.5 },
                    borderBottom: `1px solid ${neutral.line}`,
                    // Four tabs fit a 375 px phone; narrower screens can still swipe the row.
                    '& .MuiTab-root': { color: neutral.inkSecondary, minHeight: 48, minWidth: { xs: 0, sm: 90 }, px: { xs: 1.5, sm: 2 } },
                    '& .MuiTab-root.Mui-selected': { color: neutral.ink },
                    '& .MuiTabs-indicator': { backgroundColor: brand.brown },
                  }}
                >
                  {TABS.map((key) => (
                    <Tab key={key} value={key} id={`${id}-tab-${key}`} aria-controls={`${id}-panel`} label={<TabLabel text={copy.tabs[key]} count={counts?.[key]} />} />
                  ))}
                </Tabs>
                <Box role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
                  {panel}
                </Box>
              </>
            )}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <HowReviewWorks />
          </Box>
        </Box>
      </Stack>
      <Box data-testid="review-announcer" role="status" aria-live="polite" sx={srOnly}>
        {announcement}
      </Box>
    </>
  )
}
