// A-10 · Publishing status: the outbox (roadmap Phase 4) made visible. Approved content reaches the
// central app only through here; failed events are out of retries (dead letter) and can be retried.
import { styled } from '@mui/material/styles'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { Button, Card, EmptyState, focusRing, Icon, kit, PageHeader, Skeleton, StatCard, StatusBadge, Table, TableFrame, Tabs, Text } from '@shazlo/ui/components'
import { useOutbox, useRetryEvents, type OutboxEvent, type OutboxStatus } from '../../api'
import { useModuleTitle, useShell } from '../../app/shell'
import { plural } from '../shared/format'
import { CardLine, CardList, ErrorCard, Screen, StatGrid, useIsPhone } from '../shared/ui'

type Tab = 'all' | OutboxStatus

function EventBadge({ status }: { status: OutboxStatus }) {
  if (status === 'failed') return <StatusBadge tone="failed">Failed</StatusBadge>
  if (status === 'retrying') return <StatusBadge tone="publishing">Retrying</StatusBadge>
  if (status === 'waiting') return <StatusBadge tone="pending" icon="clock">Waiting</StatusBadge>
  return <StatusBadge tone="approved">Delivered</StatusBadge>
}

const tries = (e: OutboxEvent) => (e.status === 'failed' || e.status === 'retrying' ? `${e.tries}/${e.maxTries}` : String(e.tries))

function explain(e: OutboxEvent) {
  if (e.status === 'failed') {
    if (e.hint) return e.hint
    return e.response && e.response.status < 500
      ? `Tried ${e.tries} times. The central app rejected the data (${e.response.status}), so retrying the same payload will fail again; fix the item first, which creates a new revision and a new event.`
      : `Tried ${e.tries} times while the central app was unavailable. Retrying is safe: the idempotency key makes the central app ignore a duplicate.`
  }
  if (e.status === 'retrying') return `Tried ${e.tries} of ${e.maxTries} times. Next try at ${e.nextTryLabel ?? 'soon'}, with backoff (1 m, 5 m, 15 m, 1 h …). The vendor sees “Publishing” until it succeeds.`
  if (e.status === 'waiting') return 'Queued. The publisher signs it with HMAC and pushes it to the central app within a few seconds.'
  return `Delivered after ${plural(e.tries, 'try', 'tries')}. The central app accepted it, so the vendor sees it as live.`
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Text v="caption" tone="subtle">{label}</Text>
      <Text v={mono ? 'mono' : 'small'} tone="ink" style={{ overflowWrap: 'anywhere' }}>{value}</Text>
    </div>
  )
}

/** Beside the table on wide frames; full width under its card on phones (`id` set). */
function EventDetail({ event, id }: { event: OutboxEvent; id?: string }) {
  const { toast } = useShell()
  const retry = useRetryEvents()
  const payload = JSON.stringify(event.payload, null, 2)
  const canRetry = event.status === 'failed' || event.status === 'retrying'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      toast('success', 'Payload copied.')
    } catch {
      toast('error', 'Couldn’t copy. Open “Show payload” and copy it by hand.')
    }
  }

  return (
    <Card as="section" id={id} pad={id ? 16 : 20} gap={14} aria-label="Event detail" style={id ? undefined : { flex: '0 1 380px', minWidth: 300 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Text v="title" as="h2" style={{ minWidth: 0 }}>{event.item}</Text>
        <EventBadge status={event.status} />
      </div>
      <Field label="Event" value={`${event.name} · v${event.version}`} />
      <Field label="Event id" value={event.id} />
      <Field label="Idempotency key" value={event.idempotencyKey} />
      <Field label="Approved by" value={event.approvedBy} mono={false} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', background: kit.canvas, borderRadius: 6 }}>
        {event.response ? (
          <>
            <Text v="overline" tone="subtle">Last response · {event.response.at}</Text>
            <Text v="mono" tone="ink">HTTP {event.response.status} from central app</Text>
            <Text v="mono" tone="ink" style={{ overflowWrap: 'anywhere' }}>{event.response.body}</Text>
          </>
        ) : (
          <>
            <Text v="overline" tone="subtle">Last response</Text>
            <Text v="mono" tone="ink">No response yet</Text>
          </>
        )}
      </div>
      <Text v="small" tone="muted" as="p">{explain(event)}</Text>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canRetry && (
          <Button
            variant="primary"
            icon="refresh"
            disabled={retry.isPending}
            onClick={() => retry.mutate([event.id], {
              onSuccess: () => toast('success', `Retry queued for “${event.item}”.`),
              onError: e => toast('error', e.message),
            })}
          >
            {retry.isPending ? 'Retrying…' : 'Retry now'}
          </Button>
        )}
        <Button icon="copy" onClick={copy}>Copy payload</Button>
      </div>
      <details>
        <summary style={{ cursor: 'pointer' }}><Text v="caption" tone="link">Show payload</Text></summary>
        <pre style={{ margin: '8px 0 0', padding: '10px 12px', background: kit.canvas, borderRadius: 6, overflowX: 'auto' }}>
          <Text v="mono" tone="ink">{payload}</Text>
        </pre>
      </details>
    </Card>
  )
}

/** A card on phones: a button that opens the event's detail right under it. */
const EventButton = styled('button')({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: '100%',
  padding: '13px 15px',
  background: kit.surface,
  border: `1px solid ${kit.line}`,
  borderRadius: 8,
  textAlign: 'left',
  font: 'inherit',
  color: kit.ink,
  cursor: 'pointer',
  '&:hover': { background: '#FFFBEC' },
  '&[aria-expanded="true"]': { background: kit.canvas, borderColor: kit.field },
  ...focusRing,
})

/** A-10 on phones: the events as cards; the open one shows its detail underneath. */
function EventCards({ rows, openId, onToggle }: { rows: OutboxEvent[]; openId: string | undefined; onToggle: (id: string) => void }) {
  return (
    <CardList aria-label="Outbox events">
      {rows.map(e => {
        const open = e.id === openId
        return (
          <li key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <EventButton type="button" aria-expanded={open} aria-controls={open ? `event-${e.id}` : undefined} onClick={() => onToggle(e.id)}>
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <Text v="label">{e.item}</Text>
                  <Text v="mono" tone="muted" style={{ overflowWrap: 'anywhere' }}>{e.name}</Text>
                </span>
                <Icon name="chevronDown" size={16} color={kit.muted} style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined }} />
              </span>
              <CardLine style={{ width: '100%' }}>
                <EventBadge status={e.status} />
                <Text v="caption" tone="muted" tabular>Tries {tries(e)} · {e.lastLabel ?? '—'}</Text>
              </CardLine>
            </EventButton>
            {open && <EventDetail event={e} id={`event-${e.id}`} />}
          </li>
        )
      })}
    </CardList>
  )
}

export function PublishingStatus() {
  useModuleTitle('Publishing to the app')
  const { toast } = useShell()
  const phone = useIsPhone()
  const outbox = useOutbox()
  const retryAll = useRetryEvents()
  const [tab, setTab] = useState<Tab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const events = useMemo(() => outbox.data?.events ?? [], [outbox.data])
  const counts = outbox.data?.counts
  const rows = tab === 'all' ? events : events.filter(e => e.status === tab)
  const selected = rows.find(e => e.id === selectedId) ?? rows[0]
  // Phones open one card at a time, the first by default; tapping the open card closes it.
  const [closed, setClosed] = useState(false)
  const openId = closed ? undefined : selected?.id
  const toggle = (id: string) => {
    if (id === openId) { setClosed(true); return }
    setClosed(false)
    setSelectedId(id)
  }
  const failed = events.filter(e => e.status === 'failed')
  const nextTry = events.find(e => e.status === 'retrying')?.nextTryLabel
  const older = counts ? counts.delivered - events.filter(e => e.status === 'delivered').length : 0

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(id) }
  }

  return (
    <Screen gap={16}>
      <PageHeader
        title="Publishing to the app"
        subtitle="Events vendor-api sends to the central app after each approval. Delivered at least once, in order for each item."
        actions={
          <Button
            size="sm"
            icon="refresh"
            disabled={!failed.length || retryAll.isPending}
            title={failed.length ? undefined : 'Nothing has failed'}
            onClick={() => retryAll.mutate(failed.map(e => e.id), {
              onSuccess: n => toast('success', `Retrying ${plural(n, 'failed event')}.`),
              onError: e => toast('error', e.message),
            })}
          >
            Retry all failed
          </Button>
        }
      />

      {outbox.isError ? (
        <ErrorCard title="The outbox didn’t load" onRetry={() => outbox.refetch()}>
          vendor-api did not answer. Events are still being pushed; try again in a moment.
        </ErrorCard>
      ) : (
        <>
          <StatGrid aria-label="Publishing health">
            {outbox.data && counts ? (
              <>
                <StatCard label="Delivered, last 24 h" value={outbox.data.delivered24h} hint={`Median ${outbox.data.medianDeliverySeconds} s after approval`} />
                <StatCard label="Waiting" value={counts.waiting} hint={counts.waiting ? 'Next push in a few seconds' : 'Nothing queued'} />
                <StatCard label="Retrying" value={counts.retrying} hint={nextTry ? `Next try ${nextTry}` : 'No retries pending'} />
                <StatCard label="Failed" value={counts.failed} hint={counts.failed ? 'Out of retries, needs a look' : 'Nothing needs a look'} />
              </>
            ) : (
              [0, 1, 2, 3].map(i => <Skeleton key={i} height={111} radius={8} />)
            )}
          </StatGrid>

          <Tabs<Tab>
            label="Event status"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'All', count: counts?.all },
              { value: 'waiting', label: 'Waiting', count: counts?.waiting },
              { value: 'retrying', label: 'Retrying', count: counts?.retrying },
              { value: 'failed', label: 'Failed', count: counts?.failed },
              { value: 'delivered', label: 'Delivered', count: counts?.delivered },
            ]}
          />

          {outbox.isPending ? (
            <Skeleton height={300} radius={8} />
          ) : rows.length === 0 ? (
            <Card pad={0}>
              <EmptyState icon="check" title={tab === 'failed' ? 'Nothing has failed' : tab === 'retrying' ? 'Nothing is retrying' : tab === 'waiting' ? 'Nothing is waiting' : 'No events yet'}>
                {tab === 'failed' || tab === 'retrying'
                  ? 'Every approved item reached the central app. Failures show up here and on Home.'
                  : 'Approving a product, brand page or vendor creates an event here.'}
              </EmptyState>
            </Card>
          ) : phone ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <EventCards rows={rows} openId={openId} onToggle={toggle} />
              {(tab === 'all' || tab === 'delivered') && older > 0 && (
                <Text v="caption" tone="subtle">Showing the latest {plural(rows.length, 'event')}; {older.toLocaleString('en-IN')} older delivered events are not listed.</Text>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <TableFrame>
                  <Table aria-label="Outbox events" style={{ tableLayout: 'fixed', minWidth: 600 }}>
                    <colgroup>
                      <col style={{ width: 194 }} />
                      <col />
                      <col style={{ width: 126 }} />
                      <col style={{ width: 64 }} />
                      <col style={{ width: 80 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Event</th>
                        <th scope="col">Item</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">Tries</th>
                        <th scope="col">Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(e => (
                        <tr
                          key={e.id}
                          aria-selected={e.id === selected?.id}
                          tabIndex={0}
                          onClick={() => setSelectedId(e.id)}
                          onKeyDown={k => onKey(k, e.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td><Text v="mono" tone="ink" truncate style={{ display: 'block' }}>{e.name}</Text></td>
                          <td><Text v="small" truncate style={{ display: 'block' }}>{e.item}</Text></td>
                          <td><EventBadge status={e.status} /></td>
                          <td className="num">{tries(e)}</td>
                          <td><Text v="small" tone="muted">{e.lastLabel ?? '—'}</Text></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableFrame>
                {(tab === 'all' || tab === 'delivered') && older > 0 && (
                  <Text v="caption" tone="subtle">Showing the latest {plural(rows.length, 'event')}; {older.toLocaleString('en-IN')} older delivered events are not listed.</Text>
                )}
              </div>
              {selected && <EventDetail key={selected.id} event={selected} />}
            </div>
          )}
        </>
      )}
    </Screen>
  )
}
