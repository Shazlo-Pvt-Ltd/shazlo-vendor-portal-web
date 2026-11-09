import { Box, Button, Skeleton, Stack, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { Banner, PageHeader, StatFigure } from '@shazlo/ui'
import { Plus, Upload } from 'lucide-react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../api/client'
import { useMe, useSummary } from '../../api/queries'
import { paths } from '../../app/paths'
import { overviewCopy as copy } from '../../copy/overview'
import { formatCount, formatDate } from '../../lib/format'
import { BrandCard } from './BrandCard'
import { RecentDecisions } from './RecentDecisions'

const touch = { minHeight: { xs: 44, md: 36 } }

const FIGURES = [
  { status: 'approved', text: copy.stats.live },
  { status: 'pending_review', text: copy.stats.pending },
  { status: 'rejected', text: copy.stats.sentBack },
  { status: 'draft', text: copy.stats.drafts },
] as const satisfies readonly { status: Schemas['ProductStatus']; text: { label: string; baseline: string } }[]

function Subtitle() {
  const me = useMe()
  if (me.isPending) return <Skeleton variant="text" width={320} sx={{ display: 'inline-block', maxWidth: '100%' }} />
  if (!me.data) return null
  const { brand_name, approved_at } = me.data.vendor
  return copy.subtitle(brand_name, approved_at ? formatDate(approved_at) : null)
}

function SentBackBanner({ count, desktop }: { count: number; desktop: boolean }) {
  const action = (
    <Button variant="outlined" component={RouterLink} to={`${paths.review}?tab=rejected`} sx={{ ...touch, bgcolor: 'background.paper', whiteSpace: 'nowrap' }}>
      {copy.sentBack.action}
    </Button>
  )
  return (
    <Banner tone="warning" title={copy.sentBack.title(count)} action={desktop ? action : undefined}>
      {copy.sentBack.body(count)}
      {!desktop && <Box sx={{ mt: 1.5 }}>{action}</Box>}
    </Banner>
  )
}

// Four figures, each opening Products on that status. Real zeros are printed.
function Figures({ summary, desktop }: { summary: ReturnType<typeof useSummary>; desktop: boolean }) {
  const columns = desktop ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))'
  return (
    <Box component="section" aria-label={copy.stats.label} sx={{ display: 'grid', gridTemplateColumns: columns, gap: { xs: 1.5, md: 2 } }}>
      {summary.isPending ? (
        <Box role="status" aria-label={copy.stats.loading} sx={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: columns, gap: 'inherit' }}>
          {FIGURES.map((f) => (
            <Skeleton key={f.status} variant="rounded" height={112} />
          ))}
        </Box>
      ) : summary.isError ? (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Banner tone="error" title={copy.stats.error} action={<Button variant="outlined" sx={touch} onClick={() => void summary.refetch()}>{copy.retry}</Button>} />
        </Box>
      ) : (
        FIGURES.map(({ status, text }) => {
          const n = summary.data.products[status]
          const baseline = status === 'rejected' && n === 0 ? copy.stats.sentBack.baselineNone : text.baseline
          return <StatFigure key={status} label={text.label} value={formatCount(n)} baseline={baseline} href={`${paths.products}?status=${status}`} linkComponent={RouterLink} />
        })
      )}
    </Box>
  )
}

// V-04: what needs attention first (sent back), then the catalogue in numbers, then decisions and the brand page.
export default function Overview() {
  const desktop = useMediaQuery((t: Theme) => t.breakpoints.up('md'), { noSsr: true })
  const summary = useSummary()
  const sentBack = summary.data?.sent_back ?? 0

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={<Subtitle />}
        actions={
          <>
            <Button variant="outlined" component={RouterLink} to={paths.bulkImport} startIcon={<Upload size={18} strokeWidth={1.5} aria-hidden="true" />} sx={touch}>
              {copy.bulkImport}
            </Button>
            <Button variant="contained" component={RouterLink} to={paths.newProduct} startIcon={<Plus size={18} strokeWidth={1.5} aria-hidden="true" />} sx={touch}>
              {copy.addProduct}
            </Button>
          </>
        }
      />
      <Stack spacing={{ xs: 2.5, md: 3 }}>
        {sentBack > 0 && <SentBackBanner count={sentBack} desktop={desktop} />}
        <Figures summary={summary} desktop={desktop} />
        <Box sx={{ display: 'grid', gridTemplateColumns: desktop ? 'minmax(0, 2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: { xs: 2.5, md: 3 }, alignItems: 'start' }}>
          <RecentDecisions />
          <BrandCard />
        </Box>
      </Stack>
    </>
  )
}
