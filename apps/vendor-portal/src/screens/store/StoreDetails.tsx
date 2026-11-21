import { Box, Button, Card, Link, Skeleton, Stack, Typography } from '@mui/material'
import { Banner, neutral, PageHeader, radius, SectionCard } from '@shazlo/ui'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import type { Schemas } from '../../api/client'
import { useMe, useStoreDetails } from '../../api/queries'
import { paths } from '../../app/paths'
import { storeCopy as copy } from '../../copy/store'
import { SECTION_FOR_TOPIC, STORE_SECTIONS, type StoreTopic } from '../../lib/storeDetails'
import { FORM_MAX_WIDTH, useNavMode } from '../../shell/layout'
import { CommissionCard } from './CommissionCard'
import type { SavedState } from './StoreSection'
import { touch } from './topics/controls'
import { TOPIC_TITLES, type Topic } from './topics/model'
import { brandRows, businessRows, ChangeLink, contactRows, deliveryRows, paymentRows, payoutRows, returnsRows, SummaryList, type Row } from './topics/summary'

// Store details (spec §5): one card per topic, each a plain label / value list with a Change link
// to the same page sign-up used. Required topics that are missing say "To do", and the page says why
// they matter: products cannot be sent for review until they are done. Commission sits last.

const TOPIC_OF: Partial<Record<Topic, StoreTopic>> = Object.fromEntries(Object.entries(SECTION_FOR_TOPIC).map(([t, s]) => [s, t]))

// The rows of a topic, or null while it has never been saved.
function rowsOf(topic: Topic, d: Schemas['StoreDetails']): Row[] | null {
  switch (topic) {
    case 'brand': return brandRows(d)
    case 'contact': return d.contact ? contactRows(d.contact) : null
    case 'delivery': return d.delivery ? deliveryRows(d.delivery) : null
    case 'returns': return d.returns ? returnsRows(d.returns) : null
    case 'payment': return d.pay_on_delivery ? paymentRows(d.pay_on_delivery) : null
    case 'payout': return d.payout ? payoutRows(d.payout) : null
    case 'business': return businessRows(d.business)
  }
}

function TopicCard({ topic, details }: { topic: Topic; details: Schemas['StoreDetails'] }) {
  const title = TOPIC_TITLES[topic]
  const storeTopic = TOPIC_OF[topic]
  const todo = storeTopic !== undefined && details.missing.includes(storeTopic)
  const rows = rowsOf(topic, details)
  return (
    <SectionCard
      title={title}
      action={
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {todo && (
            <Typography variant="body2" sx={{ color: neutral.ink, whiteSpace: 'nowrap' }}>
              {copy.page.todo}
            </Typography>
          )}
          <ChangeLink target={{ to: paths.storeSection(topic) }} what={title} />
        </Stack>
      }
    >
      {rows ? (
        <>
          <SummaryList rows={rows} />
          {topic === 'brand' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {copy.brand.storeNameFixed}:{' '}
              <Link href={`mailto:${copy.partnersEmail}`}>{copy.partnersEmail}</Link>
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body1" color="text.secondary">
          {copy.page.notAddedYet}
        </Typography>
      )}
    </SectionCard>
  )
}

// "Finish these before you can send products for review", with a link to each missing topic.
function MissingNotice({ missing }: { missing: readonly StoreTopic[] }) {
  return (
    <Banner tone="info" title={copy.page.missingTitle}>
      <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
        {missing.map((t) => {
          const section = SECTION_FOR_TOPIC[t]
          return (
            <li key={t}>
              <Link component={RouterLink} to={paths.storeSection(section)} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, typography: 'body1' }}>
                {TOPIC_TITLES[section]}
              </Link>
            </li>
          )
        })}
      </Box>
    </Banner>
  )
}

// The result of a save, in the page (no toast). Focused on arrival so it is read out.
function SavedNotice({ saved, complete, onClose }: { saved: SavedState; complete: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Box ref={ref} tabIndex={-1} sx={{ borderRadius: `${radius.card}px`, outline: 'none' }}>
      <Banner tone="success" title={copy.page.saved(TOPIC_TITLES[saved.saved])} onClose={onClose}>
        {saved.wasIncomplete && complete ? copy.page.nowComplete : undefined}
      </Banner>
    </Box>
  )
}

function Skeletons() {
  return (
    <Stack role="status" aria-label={copy.page.loading} aria-busy="true" spacing={3}>
      {[0, 1, 2].map((i) => (
        <Card key={i} sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
          <Skeleton variant="text" width={140} height={28} />
          {[0, 1, 2].map((j) => (
            <Skeleton key={j} variant="text" sx={{ mt: 1.5 }} />
          ))}
        </Card>
      ))}
    </Stack>
  )
}

export function StoreDetailsPage() {
  const details = useStoreDetails()
  const me = useMe()
  const mode = useNavMode()
  const location = useLocation()
  const navigate = useNavigate()
  const saved = (location.state as Partial<SavedState> | null)?.saved ? (location.state as SavedState) : null
  const d = details.data

  // Desktop: the topics, with commission beside them. Tablets and phones: one column, at most 680 px.
  const layout =
    mode === 'desktop'
      ? { display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)', gap: 4, alignItems: 'start' }
      : { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3 }

  let content: ReactNode
  if (d) {
    content = (
      <Box sx={layout}>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {STORE_SECTIONS.map((topic) => (
            <TopicCard key={topic} topic={topic} details={d} />
          ))}
        </Stack>
        <Box sx={mode === 'desktop' ? { position: 'sticky', top: 80 } : undefined}>
          <CommissionCard commission={me.data?.vendor.commission} />
        </Box>
      </Box>
    )
  } else if (details.isError) {
    content = (
      <Banner
        tone="error"
        title={copy.page.loadError}
        action={
          <Button variant="outlined" onClick={() => void details.refetch()} disabled={details.isFetching} sx={touch}>
            {copy.page.retry}
          </Button>
        }
      >
        {details.error.message}
      </Banner>
    )
  } else {
    content = <Skeletons />
  }

  const notices: ReactNode[] = []
  if (saved && d) notices.push(<SavedNotice key="saved" saved={saved} complete={d.complete} onClose={() => void navigate(location.pathname + location.hash, { replace: true, state: null })} />)
  if (d && d.missing.length > 0) notices.push(<MissingNotice key="missing" missing={d.missing} />)

  return (
    <Box sx={mode === 'desktop' ? undefined : { maxWidth: FORM_MAX_WIDTH, mx: mode === 'tablet' ? 'auto' : 0 }}>
      <PageHeader title={copy.page.title} subtitle={copy.page.subtitle} />
      {notices.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: { xs: 3, md: 4 } }}>
          {notices}
        </Stack>
      )}
      {content}
    </Box>
  )
}

export default StoreDetailsPage
