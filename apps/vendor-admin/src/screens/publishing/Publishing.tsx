import { Box, Button, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Banner, brand, EmptyState, neutral, PageHeader, StatFigure } from '@shazlo/ui'
import { RefreshCw } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useOutbox, useRetryEvent, useRetryFailed, useSummary } from '../../api/queries'
import type { components } from '../../api/schema'
import { publishingCopy as copy } from '../../copy/publishing'
import { formatCount } from '../../lib/format'
import { useModuleTitle, useRuntime } from '../../runtime/runtime'
import { EventDetails } from './parts/EventDetails'
import { EventsTable } from './parts/EventsTable'

type OutboxEvent = components['schemas']['OutboxEvent']
type OutboxStatus = components['schemas']['OutboxStatus']
type Counts = components['schemas']['OutboxPage']['counts']
type TabKey = (typeof copy.tabs)[number]['key']

const STATUSES: OutboxStatus[] = ['waiting', 'retrying', 'failed', 'delivered']
const isStatus = (value: string | null): value is OutboxStatus => STATUSES.includes(value as OutboxStatus)
const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const
const message = (error: unknown) => (error instanceof Error ? error.message : '')

function StatusTabs({ value, counts, onChange }: { value: TabKey; counts: Counts | undefined; onChange: (key: TabKey) => void }) {
  return (
    <Tabs
      value={value}
      onChange={(_, key: TabKey) => onChange(key)}
      variant="scrollable"
      scrollButtons="auto"
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
  const p = summary.data?.publishing
  const value = (n: number | undefined) => (p ? formatCount(n) : summary.isPending ? <Skeleton variant="text" width={56} component="span" sx={{ display: 'inline-block' }} /> : '—')
  return (
    <Box component="section" aria-label={copy.figures.label} sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      <StatFigure label={copy.figures.delivered} value={value(p?.delivered_24h)} baseline={copy.figures.deliveredBaseline} />
      <StatFigure label={copy.figures.waiting} value={value(p?.waiting)} baseline={copy.figures.waitingBaseline} />
      <StatFigure label={copy.figures.retrying} value={value(p?.retrying)} baseline={copy.figures.retryingBaseline} />
      <StatFigure label={copy.figures.failed} value={value(p?.failed)} baseline={copy.figures.failedBaseline} />
    </Box>
  )
}

// The page's main action. With nothing failed it stays visible but disabled, and says why.
function RetryAll({ failed, pending, onRetry }: { failed: number | undefined; pending: boolean; onRetry: () => void }) {
  const reasonId = useId()
  const none = failed === 0
  return (
    <Stack spacing={0.5} sx={{ alignItems: { md: 'flex-end' } }}>
      <Button variant="contained" startIcon={<RefreshCw {...icon} />} onClick={onRetry} disabled={failed === undefined || none || pending} aria-describedby={none ? reasonId : undefined}>
        {pending ? copy.retryAllRunning : copy.retryAll(failed ?? 0)}
      </Button>
      {none && (
        <Typography id={reasonId} variant="caption" color="text.secondary">
          {copy.nothingFailed}
        </Typography>
      )}
    </Stack>
  )
}

export default function Publishing() {
  useModuleTitle(copy.title)
  const { toast } = useRuntime()
  const [search, setSearch] = useSearchParams()
  const statusParam = search.get('status')
  const status = isStatus(statusParam) ? statusParam : undefined
  const selectedId = search.get('event')

  const query = useOutbox(status)
  // Every event, so a chosen one stays in the panel when it leaves the current tab (a retried
  // failure becomes delivered). On the All tab this is the same request.
  const all = useOutbox()
  const { data } = query
  const retryOne = useRetryEvent()
  const retryFailed = useRetryFailed()
  const [retryError, setRetryError] = useState<{ id: string; text: string } | null>(null)
  const [retryAllError, setRetryAllError] = useState<string | null>(null)

  const selected: OutboxEvent | undefined = selectedId ? (data?.items.find((e) => e.id === selectedId) ?? all.data?.items.find((e) => e.id === selectedId)) : undefined

  function setParam(key: 'status' | 'event', value: string | undefined, replace = false) {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace },
    )
  }

  const select = (event: OutboxEvent) => setParam('event', event.id, selectedId !== null)
  const closeDetails = () => setParam('event', undefined)

  async function retry(event: OutboxEvent) {
    setRetryError(null)
    try {
      await retryOne.mutateAsync(event.id)
      toast('success', copy.details.retried)
    } catch (error) {
      setRetryError({ id: event.id, text: message(error) })
    }
  }

  async function retryAll() {
    setRetryAllError(null)
    try {
      const { retried } = await retryFailed.mutateAsync()
      toast('success', copy.retriedAll(retried))
    } catch (error) {
      setRetryAllError(message(error))
    }
  }

  async function copyPayload(event: OutboxEvent) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(event.payload, null, 2))
      toast('success', copy.details.copied)
    } catch {
      toast('error', copy.details.copyFailed)
    }
  }

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

  let table: ReactNode
  if (query.isError && !data) {
    table = null
  } else if (data && data.items.length === 0) {
    const empty = copy.empty[status ?? 'all']
    table = (
      <EmptyState
        illustration="box"
        title={empty.title}
        body={empty.body}
        action={
          status ? (
            <Button variant="outlined" onClick={() => setParam('status', undefined)}>
              {copy.empty.showAll}
            </Button>
          ) : undefined
        }
      />
    )
  } else {
    table = <EventsTable items={data?.items} fetching={query.isFetching} selectedId={selectedId} onSelect={select} />
  }

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} actions={<RetryAll failed={data?.counts.failed} pending={retryFailed.isPending} onRetry={() => void retryAll()} />} />
      <Stack spacing={3}>
        <Figures />
        <Stack spacing={2}>
          {retryAllError && (
            <Banner tone="error" title={copy.retryAllFailed} onClose={() => setRetryAllError(null)}>
              {retryAllError}
            </Banner>
          )}
          {errorBanner}
          <StatusTabs value={status ?? 'all'} counts={data?.counts} onChange={(key) => setParam('status', key === 'all' ? undefined : key)} />
          <Box sx={{ display: 'grid', gap: 3, alignItems: 'start', gridTemplateColumns: selected ? { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 320px' } : 'minmax(0, 1fr)' }}>
            <Box sx={{ minWidth: 0 }}>{table}</Box>
            {selected && (
              <Box sx={{ position: { md: 'sticky' }, top: { md: 16 }, minWidth: 0 }}>
                <EventDetails
                  event={selected}
                  retrying={retryOne.isPending && retryOne.variables === selected.id}
                  retryError={retryError?.id === selected.id ? retryError.text : null}
                  onRetry={() => void retry(selected)}
                  onCopy={() => void copyPayload(selected)}
                  onClose={closeDetails}
                />
              </Box>
            )}
          </Box>
        </Stack>
      </Stack>
    </>
  )
}
