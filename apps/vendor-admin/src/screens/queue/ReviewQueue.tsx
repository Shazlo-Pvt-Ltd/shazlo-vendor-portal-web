import { Box, Button, Skeleton, Stack, Tab, Tabs } from '@mui/material'
import { Banner, brand, EmptyState, neutral, PageHeader, StatFigure } from '@shazlo/ui'
import { Download } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useQueue, useSummary } from '../../api/queries'
import type { components } from '../../api/schema'
import { queueCopy as copy, type KindKey } from '../../copy/queue'
import { formatCount } from '../../lib/format'
import { phoneFullWidth, scrollingTabs, statGrid, useCompact } from '../../lib/responsive'
import { formatWait } from '../../lib/status'
import { useModuleTitle, useRuntime } from '../../runtime/runtime'
import { csvFilename, downloadText, queueCsv } from './parts/csv'
import { QueueCards, reviewPath } from './parts/QueueCards'
import { QueueFilters } from './parts/QueueFilters'
import { QueueTable } from './parts/QueueTable'
import { clearedFilters, hasFilters, toFilters, useQueueParams } from './parts/useQueueParams'

type QueueItem = components['schemas']['QueueItem']
type Counts = components['schemas']['QueuePage']['counts']

const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const

// How long the oldest item has waited, from the whole queue (not the filtered view).
function oldestWait(items: QueueItem[] | undefined): string | null {
  if (!items?.length) return null
  const oldest = Math.min(...items.map((i) => Date.parse(i.submitted_at)))
  return formatWait(Date.now() - oldest)
}

function KindTabs({ value, counts, onChange }: { value: string; counts: Counts | undefined; onChange: (key: string) => void }) {
  return (
    <Tabs
      value={value}
      onChange={(_, key: string) => onChange(key)}
      {...scrollingTabs}
      aria-label={copy.tabsLabel}
      textColor="inherit"
      sx={{ borderBottom: `1px solid ${neutral.line}`, minHeight: 44, '& .MuiTabs-indicator': { bgcolor: brand.brown } }}
    >
      {copy.tabs.map((tab) => (
        <Tab
          key={tab.key}
          value={tab.key}
          sx={{ minHeight: 44, px: 2, color: 'text.secondary', '&.Mui-selected': { color: neutral.ink } }}
          label={
            <span>
              {tab.label}
              {counts && (
                <>
                  {' '}
                  <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', ml: 0.25 }}>
                    {formatCount(counts[tab.key])}
                  </Box>
                </>
              )}
            </span>
          }
        />
      ))}
    </Tabs>
  )
}

function Figures() {
  const summary = useSummary()
  const s = summary.data
  const value = (v: ReactNode) => (s ? v : summary.isPending ? <Skeleton variant="text" width={56} component="span" sx={{ display: 'inline-block' }} /> : '—')
  return (
    <Box component="section" aria-label={copy.figures.label} sx={statGrid}>
      <StatFigure label={copy.figures.waiting} value={value(formatCount(s?.queue.all))} baseline={s ? copy.figures.waitingBaseline(s.queue.product, s.queue.brand_page, s.queue.application) : undefined} />
      <StatFigure label={copy.figures.decidedToday} value={value(formatCount(s?.decided_today))} baseline={copy.figures.decidedBaseline} />
      <StatFigure label={copy.figures.median} value={value(s?.median_minutes == null ? '—' : formatWait(s.median_minutes * 60_000))} baseline={copy.figures.medianBaseline} />
      <StatFigure label={copy.figures.resubmissions} value={value(formatCount(s?.resubmissions))} baseline={copy.figures.resubmissionsBaseline} />
    </Box>
  )
}

export default function ReviewQueue() {
  useModuleTitle(copy.title)
  const navigate = useNavigate()
  const compact = useCompact()
  const { toast } = useRuntime()
  const [params, update] = useQueueParams()
  const query = useQueue(toFilters(params))
  // The whole queue gives the header its count and oldest wait. With no filters it is the same request.
  const whole = useQueue({})
  const { data } = query
  const items = data?.items

  const onSearch = useCallback((q: string) => update({ q }, { replace: true }), [update])
  const onOpen = useCallback((item: QueueItem) => navigate(reviewPath(item)), [navigate])
  const clearFilters = () => update(clearedFilters)

  function exportCsv() {
    if (!items?.length) return
    downloadText(csvFilename(), queueCsv(items))
    toast('success', copy.exported(items.length))
  }

  const queueEmpty = data !== undefined && data.counts.all === 0
  const subtitle = whole.data ? copy.subtitle(whole.data.counts.all, oldestWait(whole.data.items)) : whole.isPending ? <Skeleton variant="text" width={260} component="span" sx={{ display: 'inline-block' }} /> : undefined

  const errorBanner = query.isError ? (
    <Banner
      tone="error"
      title={copy.error.title}
      action={
        <Button variant="outlined" size="small" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {copy.error.retry}
        </Button>
      }
    >
      {query.error.message}
    </Banner>
  ) : null

  let body: ReactNode
  if (query.isError && !data) {
    body = null
  } else if (queueEmpty) {
    body = <EmptyState illustration="box" tip={copy.empty.tip} title={copy.empty.title} body={copy.empty.body} />
  } else if (items && items.length === 0 && hasFilters(params)) {
    body = (
      <EmptyState
        illustration="box"
        title={copy.noResults.title}
        body={copy.noResults.body}
        action={
          <Button variant="outlined" onClick={clearFilters}>
            {copy.noResults.clear}
          </Button>
        }
      />
    )
  } else if (items && items.length === 0) {
    const tab = copy.tabs.find((t) => t.key === params.kind)?.label ?? ''
    body = (
      <EmptyState
        illustration="box"
        title={copy.emptyTab.title(tab)}
        body={copy.emptyTab.body}
        action={
          <Button variant="outlined" onClick={() => update({ kind: undefined })}>
            {copy.emptyTab.showAll}
          </Button>
        }
      />
    )
  } else {
    body = compact ? <QueueCards items={items} fetching={query.isFetching} /> : <QueueTable items={items} fetching={query.isFetching} onOpen={onOpen} />
  }

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={subtitle}
        actions={
          <Button variant="outlined" startIcon={<Download {...icon} />} onClick={exportCsv} disabled={!items?.length} sx={phoneFullWidth}>
            {copy.exportCsv}
          </Button>
        }
      />
      <Stack spacing={3}>
        <Figures />
        <Stack spacing={2}>
          {errorBanner}
          <KindTabs value={params.kind ?? 'all'} counts={data?.counts} onChange={(key) => update({ kind: key === 'all' ? undefined : (key as KindKey) })} />
          {!queueEmpty && <QueueFilters params={params} update={update} onSearch={onSearch} vendors={data?.vendors ?? []} />}
          {body}
        </Stack>
      </Stack>
    </>
  )
}
