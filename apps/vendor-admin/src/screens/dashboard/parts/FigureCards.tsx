import { Box, Button, Stack } from '@mui/material'
import { SectionCard, StatFigure } from '@shazlo/ui'
import { ClipboardList, Send, Store } from 'lucide-react'
import { Link as RouterLink } from 'react-router'
import { useSummary, useVendors } from '../../../api/queries'
import { modulePaths } from '../../../app/routes'
import { CardTitle } from '../../../components/CardTitle'
import { dashboardCopy } from '../../../copy/dashboard'
import { publishingCopy } from '../../../copy/publishing'
import { formatCount } from '../../../lib/format'
import { ActionBanner, bannerButtonSx, FigureSkeletons, figureGrid, Loaded, TextLink } from './common'
import { dashboardLinks as links } from './links'

// Who is selling, who is waiting to, and whose rate or account needs Shazlo. From the vendor list's
// counts.
export function VendorsCard() {
  const copy = dashboardCopy.vendors
  const query = useVendors({})
  return (
    <SectionCard title={<CardTitle icon={Store}>{copy.title}</CardTitle>} action={<TextLink to={modulePaths.vendors}>{copy.all}</TextLink>}>
      <Loaded query={query} data={query.data?.counts} subject={copy.label} errorTitle={copy.error} skeleton={<FigureSkeletons label={copy.loading} />}>
        {(counts) => (
          <Box role="group" aria-label={copy.label} sx={figureGrid}>
            <StatFigure label={copy.live} value={formatCount(counts.approved)} baseline={copy.liveBaseline} href={links.vendorsWith('approved')} linkComponent={RouterLink} />
            <StatFigure label={copy.applications} value={formatCount(counts.applied + counts.under_review)} baseline={copy.applicationsBaseline(counts.applied, counts.under_review)} href={links.queueOf('application')} linkComponent={RouterLink} />
            <StatFigure label={copy.rates} value={formatCount(counts.rate_to_review)} baseline={copy.ratesBaseline} href={links.rates} linkComponent={RouterLink} />
            <StatFigure label={copy.suspended} value={formatCount(counts.suspended)} baseline={copy.suspendedBaseline} href={links.vendorsWith('suspended')} linkComponent={RouterLink} />
          </Box>
        )}
      </Loaded>
    </SectionCard>
  )
}

// What waits for a decision, and how many were decided today. From the summary.
export function QueueCard() {
  const copy = dashboardCopy.queue
  const query = useSummary()
  return (
    <SectionCard title={<CardTitle icon={ClipboardList}>{copy.title}</CardTitle>}>
      <Loaded query={query} data={query.data} subject={copy.label} errorTitle={copy.error} skeleton={<FigureSkeletons label={copy.loading} />}>
        {(summary) => (
          <Box role="group" aria-label={copy.label} sx={figureGrid}>
            <StatFigure label={copy.products} value={formatCount(summary.queue.product)} baseline={copy.productsBaseline} href={links.queueOf('product')} linkComponent={RouterLink} />
            <StatFigure label={copy.brandPages} value={formatCount(summary.queue.brand_page)} baseline={copy.brandPagesBaseline} href={links.queueOf('brand_page')} linkComponent={RouterLink} />
            <StatFigure label={copy.over24h} value={formatCount(summary.queue.over_24h)} baseline={copy.over24hBaseline} href={links.queueOldest} linkComponent={RouterLink} />
            <StatFigure label={copy.decidedToday} value={formatCount(summary.decided_today)} baseline={copy.decidedTodayBaseline} />
          </Box>
        )}
      </Loaded>
    </SectionCard>
  )
}

// Approved changes on their way to the consumer app. A failure gets a warning above the figures.
// The figures carry the publishing page's own words, the screen they open.
export function PublishingCard() {
  const copy = dashboardCopy.publishing
  const figures = publishingCopy.figures
  const query = useSummary()
  return (
    <SectionCard title={<CardTitle icon={Send}>{copy.title}</CardTitle>} action={<TextLink to={modulePaths.publishing}>{copy.open}</TextLink>}>
      <Loaded query={query} data={query.data?.publishing} subject={figures.label} errorTitle={copy.error} skeleton={<FigureSkeletons label={copy.loading} />}>
        {(publishing) => (
          <Stack spacing={2}>
            {publishing.failed > 0 && (
              <ActionBanner
                tone="warning"
                title={copy.failedBanner.title(publishing.failed)}
                action={
                  <Button variant="outlined" component={RouterLink} to={links.publishingWith('failed')} sx={bannerButtonSx}>
                    {copy.failedBanner.action}
                  </Button>
                }
              >
                {copy.failedBanner.body}
              </ActionBanner>
            )}
            <Box role="group" aria-label={figures.label} sx={figureGrid}>
              <StatFigure label={figures.delivered} value={formatCount(publishing.delivered_24h)} baseline={figures.deliveredBaseline} href={links.publishingWith('delivered')} linkComponent={RouterLink} />
              <StatFigure label={figures.waiting} value={formatCount(publishing.waiting)} baseline={figures.waitingBaseline} href={links.publishingWith('waiting')} linkComponent={RouterLink} />
              <StatFigure label={figures.retrying} value={formatCount(publishing.retrying)} baseline={figures.retryingBaseline} href={links.publishingWith('retrying')} linkComponent={RouterLink} />
              <StatFigure label={figures.failed} value={formatCount(publishing.failed)} baseline={figures.failedBaseline} href={links.publishingWith('failed')} linkComponent={RouterLink} />
            </Box>
          </Stack>
        )}
      </Loaded>
    </SectionCard>
  )
}
