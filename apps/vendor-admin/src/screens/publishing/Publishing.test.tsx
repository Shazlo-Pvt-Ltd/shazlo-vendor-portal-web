import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'

type Router = ReturnType<typeof renderModule>['router']

// Seed (packages/mock-vendor-api): 16 outbox events, newest first. One failed (the Phulkari
// dupatta, 6 tries), one retrying, two waiting, twelve delivered.
const ALL = [
  'Phulkari Dupatta — Mustard',
  'Linen Co-ord Set — Indigo',
  'Handloom Cotton Shirt — Rust',
  'Nila Handloom',
  'Bandhani Silk Dupatta',
  'Kalki Studio',
  'Chikankari Kurti — Ivory',
  'Kala Cotton Jacket',
  'Trendz Outlet',
  'Leheriya Cotton Dupatta',
  'Bagru Print Palazzo',
  'Ikat Cotton Wrap Dress',
  'Kantha Stitch Jacket',
  'Sutra Collective',
  'Shibori Indigo Scarf',
  'Jamdani Cotton Saree',
]

async function eventsTable() {
  // The first visit compiles the screen's chunk; give it room on a busy machine.
  return screen.findByRole('table', { name: 'Outbox events' }, { timeout: 10_000 })
}

// Data rows only (the first row holds the column headers).
function rows(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1)
}

function items(table: HTMLElement) {
  return rows(table).map((r) => r.getAttribute('data-item'))
}

async function waitForItems(expected: string[]) {
  const table = await eventsTable()
  await waitFor(
    () => {
      expect(table).not.toHaveAttribute('aria-busy', 'true')
      expect(items(table)).toEqual(expected)
    },
    { timeout: 10_000 },
  )
  return table
}

function row(table: HTMLElement, item: string) {
  return rows(table).find((r) => r.getAttribute('data-item') === item)!
}

function params(router: Router) {
  return new URLSearchParams(router.state.location.search)
}

describe('A-10 Publishing to the app', { timeout: 40_000 }, () => {
  it('names itself to the shell and shows the outbox with its figures', async () => {
    const { shell } = renderModule({ route: '/publishing' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Publishing to the app' })).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/publishing', title: 'Publishing to the app' }))
    expect(screen.getByText(/^Approved changes reach the consumer app through the outbox\./)).toBeInTheDocument()

    const delivered = await screen.findByRole('group', { name: 'Delivered in the last 24 h' })
    await waitFor(() => expect(within(delivered).getByText('324')).toBeInTheDocument())
    expect(within(screen.getByRole('group', { name: 'Waiting' })).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Retrying' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Failed' })).getByText('1')).toBeInTheDocument()

    const tabs = screen.getByRole('tablist', { name: 'Event status' })
    await waitFor(() => expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 16', 'Waiting 2', 'Retrying 1', 'Failed 1', 'Delivered 12']))

    const table = await waitForItems(ALL)
    for (const name of ['Event', 'Item', 'Vendor', 'Status', 'Tries', 'Last attempt', 'Next attempt']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    const failed = row(table, 'Phulkari Dupatta — Mustard')
    expect(within(failed).getByText('product.published')).toBeInTheDocument()
    expect(within(failed).getByText('Nila Handloom')).toBeInTheDocument()
    expect(within(failed).getByText('Failed')).toBeInTheDocument()
    expect(within(failed).getByText('6')).toBeInTheDocument()
    expect(within(failed).getByText('58 min ago')).toBeInTheDocument()
    expect(within(failed).getByText('—')).toBeInTheDocument()

    const retrying = row(table, 'Linen Co-ord Set — Indigo')
    expect(within(retrying).getByText('Retrying')).toBeInTheDocument()
    expect(within(retrying).getByText('In 4 min')).toBeInTheDocument()

    const waiting = row(table, 'Handloom Cotton Shirt — Rust')
    expect(within(waiting).getByText('product.updated')).toBeInTheDocument()
    expect(within(waiting).getByText('Waiting')).toBeInTheDocument()
    // Never tried yet: no last attempt.
    expect(within(waiting).getByText('—')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Retry all failed (1)' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Event details' })).toBeNull()
  })

  it('switches status tabs through the URL', async () => {
    const { user, router } = renderModule({ route: '/publishing' })
    await waitForItems(ALL)
    await user.click(screen.getByRole('tab', { name: 'Waiting 2' }))
    expect(params(router).get('status')).toBe('waiting')
    await waitForItems(['Handloom Cotton Shirt — Rust', 'Nila Handloom'])
    expect(screen.getByRole('tab', { name: 'Waiting 2' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Failed 1' }))
    await waitForItems(['Phulkari Dupatta — Mustard'])

    await router.navigate(-1)
    await waitForItems(['Handloom Cotton Shirt — Rust', 'Nila Handloom'])
  })

  it('opens an event from the link on its tab', async () => {
    renderModule({ route: '/publishing?status=retrying&event=evt_0002' })
    await waitForItems(['Linen Co-ord Set — Indigo'])
    const details = await screen.findByRole('region', { name: 'Event details' })
    expect(within(details).getByRole('heading', { name: 'Linen Co-ord Set — Indigo' })).toBeInTheDocument()
    expect(within(details).getByText('HTTP 503 from central app: try again shortly')).toBeInTheDocument()
  })

  it('shows an event’s details when its row is chosen by click or Enter', async () => {
    const { user, router } = renderModule({ route: '/publishing' })
    const table = await waitForItems(ALL)

    await user.click(within(row(table, 'Phulkari Dupatta — Mustard')).getByText('product.published'))
    expect(params(router).get('event')).toBe('evt_0001')
    const details = await screen.findByRole('region', { name: 'Event details' })
    expect(within(details).getByRole('heading', { name: 'Phulkari Dupatta — Mustard' })).toBeInTheDocument()
    expect(within(details).getByText('product.published')).toBeInTheDocument()
    expect(within(details).getByText('Nila Handloom')).toBeInTheDocument()
    expect(within(details).getByText('6')).toBeInTheDocument()
    expect(within(details).getByText(/^(Today|Yesterday), \d\d:\d\d$/)).toBeInTheDocument()
    expect(within(details).getByText('HTTP 500 from central app: embedding service timed out')).toBeInTheDocument()
    const payload = within(details).getByRole('region', { name: 'Payload' })
    expect(payload).toHaveAttribute('tabindex', '0')
    expect(payload).toHaveTextContent('"idempotency_key": "idem_1"')
    expect(within(details).getByRole('button', { name: 'Retry now' })).toBeInTheDocument()
    expect(row(table, 'Phulkari Dupatta — Mustard')).toHaveAttribute('aria-selected', 'true')

    // Keyboard: focus a row and press Enter.
    row(table, 'Bandhani Silk Dupatta').focus()
    await user.keyboard('{Enter}')
    expect(params(router).get('event')).toBe('evt_0005')
    await waitFor(() => expect(within(details).getByRole('heading', { name: 'Bandhani Silk Dupatta' })).toBeInTheDocument())
    // Delivered events cannot be retried.
    expect(within(details).queryByRole('button', { name: 'Retry now' })).toBeNull()
    expect(within(details).getByRole('button', { name: 'Copy payload' })).toBeInTheDocument()

    await user.click(within(details).getByRole('button', { name: 'Close details' }))
    expect(params(router).get('event')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Event details' })).toBeNull()
  })

  it('retries one event now and updates its row', async () => {
    const { user, shell } = renderModule({ route: '/publishing?event=evt_0001' })
    const table = await waitForItems(ALL)
    const details = await screen.findByRole('region', { name: 'Event details' })
    await user.click(within(details).getByRole('button', { name: 'Retry now' }))

    await waitFor(() => expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Delivered to the app' }))
    await waitFor(() => expect(within(row(table, 'Phulkari Dupatta — Mustard')).getByText('Delivered')).toBeInTheDocument(), { timeout: 10_000 })
    expect(within(row(table, 'Phulkari Dupatta — Mustard')).getByText('7')).toBeInTheDocument()
    expect(within(details).queryByRole('button', { name: 'Retry now' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Failed 0' })).toBeInTheDocument())
  })

  it('retries every failed event at once', async () => {
    const { user, shell } = renderModule({ route: '/publishing' })
    const table = await waitForItems(ALL)
    await user.click(screen.getByRole('button', { name: 'Retry all failed (1)' }))

    await waitFor(() => expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Retried 1 event. It reached the app.' }))
    await waitFor(() => expect(within(row(table, 'Phulkari Dupatta — Mustard')).getByText('Delivered')).toBeInTheDocument(), { timeout: 10_000 })
    const retryAll = await screen.findByRole('button', { name: 'Retry all failed' })
    expect(retryAll).toBeDisabled()
    expect(retryAll).toHaveAccessibleDescription('Nothing has failed')
  })

  it('cannot retry all when nothing has failed, and says why', async () => {
    const { db } = renderModule({ route: '/publishing' })
    for (const e of db.outbox) if (e.status === 'failed') e.status = 'delivered'
    await waitForItems(ALL)
    const retryAll = screen.getByRole('button', { name: 'Retry all failed' })
    expect(retryAll).toBeDisabled()
    expect(retryAll).toHaveAccessibleDescription('Nothing has failed')
    expect(screen.getByRole('tab', { name: 'Failed 0' })).toBeInTheDocument()
  })

  it('copies the payload, and says when the copy fails', async () => {
    const { user, shell } = renderModule({ route: '/publishing?event=evt_0003' })
    await waitForItems(ALL)
    // user-event installs its own clipboard; watch that one.
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce(undefined)
    const details = await screen.findByRole('region', { name: 'Event details' })
    await user.click(within(details).getByRole('button', { name: 'Copy payload' }))
    await waitFor(() => expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Payload copied' }))
    const copied = JSON.parse(write.mock.calls[0]![0])
    expect(copied).toMatchObject({ event: 'product.updated', idempotency_key: 'idem_3', subject: 'Handloom Cotton Shirt — Rust' })

    write.mockRejectedValueOnce(new Error('Denied'))
    await user.click(within(details).getByRole('button', { name: 'Copy payload' }))
    await waitFor(() => expect(shell.toasts()).toContainEqual({ level: 'error', message: 'Could not copy. Select the payload and copy it yourself.' }))
  })

  it('says when a tab is empty, and shows a load error with a way to try again', async () => {
    const { user, router, db } = renderModule({ route: '/publishing' })
    for (const e of db.outbox) if (e.status === 'retrying') e.status = 'delivered'
    await waitForItems(ALL)
    await user.click(screen.getByRole('tab', { name: /^Retrying/ }))
    expect(await screen.findByRole('heading', { name: 'Nothing retrying' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all events' }))
    expect(params(router).get('status')).toBeNull()

    server.use(http.get('*/api/v1/admin/outbox', () => HttpResponse.json({ message: 'The outbox is not available to your role.', extra: { code: 'forbidden' } }, { status: 403 })))
    await router.navigate('/publishing?status=waiting')
    expect(await screen.findByText('Events did not load')).toBeInTheDocument()
    expect(screen.getByText('The outbox is not available to your role.')).toBeInTheDocument()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitForItems(['Handloom Cotton Shirt — Rust', 'Nila Handloom'])
    expect(screen.queryByText('Events did not load')).toBeNull()
  })
})
