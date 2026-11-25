import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { OUTBOX_STATUSES } from '../../lib/status'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'
import { isSemibold } from '../../test/style'
import { setViewport } from '../../test/viewport'

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

// The seed's events with a status, in the outbox's order (newest first).
const SEED: Record<(typeof OUTBOX_STATUSES)[number], string[]> = {
  waiting: ['Handloom Cotton Shirt — Rust', 'Nila Handloom'],
  retrying: ['Linen Co-ord Set — Indigo'],
  failed: ['Phulkari Dupatta — Mustard'],
  delivered: ALL.slice(4),
}
const TAB: Record<(typeof OUTBOX_STATUSES)[number], string> = { waiting: 'Waiting 2', retrying: 'Retrying 1', failed: 'Failed 1', delivered: 'Delivered 12' }

async function waitForCards(expected: string[]) {
  const list = await screen.findByRole('list', { name: 'Outbox events' }, { timeout: 10_000 })
  await waitFor(
    () => {
      expect(list).not.toHaveAttribute('aria-busy', 'true')
      expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-item'))).toEqual(expected)
    },
    { timeout: 10_000 },
  )
  return list
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
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Event', 'Item', 'Vendor', 'Status', 'Tries', 'Last attempt', 'Next attempt'])
    for (const name of ['Event', 'Item', 'Vendor', 'Status', 'Tries', 'Last attempt', 'Next attempt']) {
      expect(isSemibold(within(table).getByRole('columnheader', { name }))).toBe(true)
    }
    const failed = row(table, 'Phulkari Dupatta — Mustard')
    // The item's name in semibold; each row ends in a chevron, as it opens the event's details.
    expect(isSemibold(within(failed).getByText('Phulkari Dupatta — Mustard'))).toBe(true)
    expect(failed.querySelector('[data-chevron]')!.closest('[aria-hidden="true"]')).not.toBeNull()
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

    server.use(http.get('*/api/v1/admin/outbox', () => HttpResponse.json({ error: { code: 'forbidden', message: 'The outbox is not available to your role.', request_id: 'r' } }, { status: 403 })))
    await router.navigate('/publishing?status=waiting')
    expect(await screen.findByText('Events did not load')).toBeInTheDocument()
    expect(screen.getByText('The outbox is not available to your role.')).toBeInTheDocument()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitForItems(['Handloom Cotton Shirt — Rust', 'Nila Handloom'])
    expect(screen.queryByText('Events did not load')).toBeNull()
  })
})

// Shazlo One's home links to /vendors/publishing?status=<status>; the shell opens the module at
// /publishing?status=<status>, or sends it there with `navigate` when it is already open.
describe('A-10 Publishing: deep links from the Shazlo One home', { timeout: 40_000 }, () => {
  for (const status of OUTBOX_STATUSES) {
    it(`opens ?status=${status} with that filter on a desktop`, async () => {
      const { shell, router } = renderModule({ route: `/publishing?status=${status}` })
      await waitForItems(SEED[status])
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(TAB[status])
      expect(params(router).get('status')).toBe(status)
      // The shell keeps the filter in its own URL.
      await waitFor(() => expect(shell.titles()).toContainEqual({ path: `/publishing?status=${status}`, title: 'Publishing to the app' }))
    })

    it(`opens ?status=${status} with that filter on a phone`, async () => {
      setViewport(390)
      renderModule({ route: `/publishing?status=${status}` })
      await waitForCards(SEED[status])
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(TAB[status])
    })
  }

  it('follows the shell to each filter while open, and back to all', async () => {
    const { shell } = renderModule({ route: '/publishing' })
    await waitForItems(ALL)
    for (const status of OUTBOX_STATUSES) {
      shell.navigate(`/publishing?status=${status}`)
      await waitForItems(SEED[status])
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(TAB[status])
    }
    shell.navigate('/publishing')
    await waitForItems(ALL)
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('All 16')
  })

  it('keeps a chosen event open from the link along with the filter', async () => {
    renderModule({ route: '/publishing?status=failed&event=evt_0001' })
    await waitForItems(SEED.failed)
    expect(within(await screen.findByRole('region', { name: 'Event details' })).getByRole('heading', { name: 'Phulkari Dupatta — Mustard' })).toBeInTheDocument()
  })

  it('shows every event for a status it does not know, and for an empty one', async () => {
    const { shell } = renderModule({ route: '/publishing?status=Failed' })
    await waitForItems(ALL)
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('All 16')
    shell.navigate('/publishing?status=')
    await waitForItems(ALL)
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('All 16')
  })

  it('draws its tabs as pressable', async () => {
    renderModule({ route: '/publishing?status=failed' })
    await waitForItems(SEED.failed)
    for (const tab of screen.getAllByRole('tab')) {
      expect(getComputedStyle(tab).cursor).toBe('pointer')
      expect(isSemibold(tab)).toBe(true)
    }
  })
})
