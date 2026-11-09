// A-04 · Review queue: every reviewable item (products, brand pages, vendor applications), oldest first.
import { useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  Button, Card, Checkbox, EmptyState, kit, PageHeader, Skeleton, StatCard, Table, TableFrame, Tabs, Text, TextInput,
} from '@shazlo/ui/components'
import { useQueue, type QueueItem, type QueueKind } from '../../api'
import { useModuleTitle } from '../../app/shell'
import { downloadCsv, formatDuration, formatWaiting, isOverdue, itemPath, plural } from '../shared/format'
import { ErrorCard, FilterMenu, Screen, StatGrid, Toolbar } from '../shared/ui'

type Tab = 'all' | QueueKind
type Submitted = 'any' | QueueItem['submittedDay']

const submittedOptions: Array<{ value: Submitted; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'earlier', label: 'Earlier' },
]

const sortOptions = [
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
]

/** Row thumbnail: a portrait photo for products, a round logo for brand pages and applications. */
function Thumb({ kind }: { kind: QueueKind }) {
  const product = kind === 'product'
  return <span aria-hidden style={{ width: 36, height: product ? 44 : 36, borderRadius: product ? 6 : 18, background: kit.placeholder, flexShrink: 0, display: 'block' }} />
}

export function ReviewQueue() {
  useModuleTitle('Review queue')
  const navigate = useNavigate()
  const queue = useQueue()
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('all')
  const [submitted, setSubmitted] = useState<Submitted>('any')
  const [resubOnly, setResubOnly] = useState(false)
  const [sort, setSort] = useState('oldest')

  const items = useMemo(() => queue.data?.items ?? [], [queue.data])
  const stats = queue.data?.stats

  const vendorOptions = useMemo(() => {
    const names = [...new Set(items.map(i => i.vendorName).filter((n): n is string => Boolean(n)))].sort()
    return [{ value: 'all', label: 'All' }, ...names.map(n => ({ value: n, label: n }))]
  }, [items])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = items.filter(i =>
      (tab === 'all' || i.kind === tab)
      && (vendor === 'all' || i.vendorName === vendor)
      && (submitted === 'any' || i.submittedDay === submitted)
      && (!resubOnly || i.resubmission)
      && (!q || [i.title, i.subtitle, i.vendorName ?? '', i.sku ?? ''].some(s => s.toLowerCase().includes(q))))
    return sort === 'newest' ? [...list].reverse() : list
  }, [items, tab, vendor, submitted, resubOnly, search, sort])

  const count = (k: QueueKind) => items.filter(i => i.kind === k).length
  const filtered = search.trim() !== '' || vendor !== 'all' || submitted !== 'any' || resubOnly
  const clearFilters = () => { setSearch(''); setVendor('all'); setSubmitted('any'); setResubOnly(false) }

  const open = (item: QueueItem) => navigate(itemPath(item))
  const onRowClick = (e: MouseEvent, item: QueueItem) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    open(item)
  }

  const exportCsv = () => downloadCsv('review-queue.csv', [
    ['Item', 'Details', 'Vendor', 'Submitted', 'Waiting', 'Type'],
    ...rows.map(r => [r.title, r.subtitle, r.vendorName, r.submittedLabel, formatWaiting(r.waitingMinutes), r.typeLabel]),
  ])

  const decidedHint = stats
    ? [`${stats.approvedToday} approved`, `${stats.sentBackToday} sent back`, ...(stats.rejectedToday ? [`${stats.rejectedToday} rejected`] : [])].join(' · ')
    : ''

  return (
    <Screen>
      <PageHeader
        title="Review queue"
        subtitle={stats ? `${plural(stats.waiting, 'item')} waiting · ${sort === 'newest' ? 'newest' : 'oldest'} first` : ' '}
        actions={<Button size="sm" icon="download" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />

      {queue.isError ? (
        <ErrorCard title="The review queue didn’t load" onRetry={() => queue.refetch()}>
          vendor-api did not answer. Check your connection and try again; if it keeps failing, the service may be down (see Home).
        </ErrorCard>
      ) : (
        <>
          <StatGrid aria-label="Queue health">
            {stats ? (
              <>
                <StatCard label="Waiting" value={stats.waiting} hint={stats.waiting ? `Oldest ${formatWaiting(stats.oldestMinutes)}` : 'Nothing waiting'} />
                <StatCard label="Decided today" value={stats.decidedToday} hint={decidedHint} />
                <StatCard label="Median time to decision" value={formatDuration(stats.medianDecisionMinutes)} hint="Target: under 24 h" />
                <StatCard label="Resubmissions waiting" value={stats.resubmissionsWaiting} hint="Reviewed before" />
              </>
            ) : (
              [0, 1, 2, 3].map(i => <Skeleton key={i} height={111} radius={8} />)
            )}
          </StatGrid>

          <Tabs<Tab>
            label="Item type"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'All', count: items.length },
              { value: 'product', label: 'Products', count: count('product') },
              { value: 'brand_page', label: 'Brand pages', count: count('brand_page') },
              { value: 'application', label: 'Vendor applications', count: count('application') },
            ]}
          />

          <Toolbar>
            <TextInput
              icon="search"
              type="search"
              aria-label="Search item, vendor or SKU"
              placeholder="Search item, vendor or SKU"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 280, maxWidth: '100%' }}
            />
            <FilterMenu label="Vendor" value={vendor} options={vendorOptions} onChange={setVendor} />
            <FilterMenu label="Submitted" value={submitted} options={submittedOptions} onChange={v => setSubmitted(v as Submitted)} />
            <Checkbox label="Resubmissions only" checked={resubOnly} onChange={e => setResubOnly(e.target.checked)} />
            <span className="spacer" />
            <FilterMenu bare label="Sort" value={sort} options={sortOptions} onChange={setSort} />
          </Toolbar>

          {queue.isPending ? (
            <TableFrame role="status" aria-label="Loading the queue">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: i ? `1px solid ${kit.line}` : 0 }}>
                  <Skeleton width={36} height={44} radius={6} />
                  <Skeleton width="30%" />
                  <Skeleton width="15%" style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </TableFrame>
          ) : items.length === 0 ? (
            <Card pad={0}>
              <EmptyState icon="check" title="The queue is clear">
                Nothing is waiting for review. New products, brand page edits and vendor applications appear here as they are submitted.
              </EmptyState>
            </Card>
          ) : rows.length === 0 ? (
            <Card pad={0}>
              <EmptyState icon="search" title="No items match these filters" action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>}>
                {filtered ? 'Try another vendor or time, or clear the filters to see the whole queue.' : 'Nothing of this type is waiting. Pick another tab.'}
              </EmptyState>
            </Card>
          ) : (
            <TableFrame style={{ position: 'relative' }}>
              <Table aria-label="Review queue" style={{ tableLayout: 'fixed', minWidth: 860 }}>
                <colgroup>
                  <col />
                  <col style={{ width: 166 }} />
                  <col style={{ width: 136 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 166 }} />
                  <col style={{ width: 94 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Waiting</th>
                    <th scope="col">Type</th>
                    <th scope="col"><span className="shz-visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(item => {
                    const overdue = isOverdue(item.waitingMinutes)
                    return (
                      <tr key={`${item.kind}-${item.id}`} onClick={e => onRowClick(e, item)} style={{ cursor: 'pointer' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                            <Thumb kind={item.kind} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                              <Text v="label" truncate>{item.title}</Text>
                              <Text v="caption" tone="subtle" truncate>{item.subtitle}</Text>
                            </div>
                          </div>
                        </td>
                        <td>{item.vendorName ?? <span aria-label="No vendor yet">—</span>}</td>
                        <td><Text v="small" tone="muted">{item.submittedLabel}</Text></td>
                        <td>
                          <Text v={overdue ? 'label' : 'small'} tabular title={overdue ? 'Over the 24-hour target' : undefined}>{formatWaiting(item.waitingMinutes)}</Text>
                        </td>
                        <td>{item.resubmission ? <Text v="label">{item.typeLabel}</Text> : <Text v="small" tone="muted">{item.typeLabel}</Text>}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Button size="sm" to={itemPath(item)} aria-label={`Review ${item.title}`}>Review</Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </TableFrame>
          )}
        </>
      )}
    </Screen>
  )
}
