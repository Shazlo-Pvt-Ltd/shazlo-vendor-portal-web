import type { MockVendorApi } from '@shazlo/mock-vendor-api'
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeSummary } from '../api/summary'
import { renderShell } from '../test/render'
import * as mocks from '../test/server'

const { server } = mocks

// Monday 9 Nov 2026, 14:00 IST. Both mocks build their seed relative to it.
const NOW = new Date('2026-11-09T14:00:00+05:30')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

// Changes the vendor seed that the next renderShell creates, before any request reads it.
function seed(change: (db: MockVendorApi) => void) {
  server.use(
    http.all('*/v1/admin/*', () => {
      change(mocks.vendorDb)
    }),
  )
}

const region = (name: string) => screen.findByRole('region', { name })

const figure = (card: HTMLElement, label: string) => within(card).findByRole('group', { name: label })

// The icon beside a card's title (decoration, so it is hidden from screen readers).
const headerIcon = (card: HTMLElement) => card.querySelector('h2')!.parentElement!.querySelector('svg')

const semibold = (el: HTMLElement) => {
  const style = getComputedStyle(el)
  return style.fontFamily.includes('Bodoni Moda') && style.fontWeight === '600'
}

describe('A-02 Home: greeting', () => {
  it.each([
    ['2026-11-09T08:15:00+05:30', 'Good morning, Naman'],
    ['2026-11-09T14:00:00+05:30', 'Good afternoon, Naman'],
    ['2026-11-09T19:30:00+05:30', 'Good evening, Naman'],
  ])('greets by the time of day in IST (%s)', async (iso, greeting) => {
    vi.setSystemTime(new Date(iso))
    await renderShell()
    expect(await screen.findByRole('heading', { level: 1, name: greeting })).toBeInTheDocument()
    expect(screen.getByText('Here is what is waiting across Shazlo One.')).toBeInTheDocument()
  })
})

describe('A-02 Home: Vendors', () => {
  it('shows the queue in numbers and opens the review queue', async () => {
    await renderShell()
    const card = await region('Vendors')
    const expected = [
      ['Waiting', '14', 'Products 9 · Brand pages 2 · Applications 3'],
      ['Waiting over 24 hours', '6', 'Oldest first in the queue'],
      ['Decided today', '1', 'Approved or sent back since midnight'],
      ['Median time to decision', '5 h 20 m', 'From submission to decision'],
    ] as const
    for (const [label, value, baseline] of expected) {
      const group = await figure(card, label)
      expect(within(group).getByText(value)).toBeInTheDocument()
      expect(within(group).getByText(baseline)).toBeInTheDocument()
    }
    expect(within(card).getByRole('link', { name: 'Open review queue' })).toHaveAttribute('href', '/vendors/queue')
  })

  it('opens the queue from the waiting figures; the other two figures are not links', async () => {
    await renderShell()
    const card = await region('Vendors')
    const linked = [
      ['Waiting', '/vendors/queue'],
      // The queue has no "over 24 hours" filter (only 24–48 h and older), so this opens it oldest first.
      ['Waiting over 24 hours', '/vendors/queue?sort=oldest'],
    ] as const
    for (const [label, href] of linked) {
      const link = within(await figure(card, label)).getByRole('link')
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAccessibleName(new RegExp(`^${label}`))
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
    for (const label of ['Decided today', 'Median time to decision']) {
      const group = await figure(card, label)
      expect(within(group).queryByRole('link')).toBeNull()
      expect(group.querySelector('svg')).toBeNull()
    }
  })

  it('sets the card title, figure labels and values in semibold, with an icon by the title', async () => {
    await renderShell()
    const card = await region('Vendors')
    expect(semibold(within(card).getByRole('heading', { level: 2, name: 'Vendors' }))).toBe(true)
    expect(headerIcon(card)).toHaveAttribute('aria-hidden', 'true')
    const waiting = await figure(card, 'Waiting')
    expect(semibold(within(waiting).getByText('Waiting'))).toBe(true)
    expect(semibold(within(waiting).getByText('14'))).toBe(true)
    expect(semibold(within(waiting).getByText('Products 9 · Brand pages 2 · Applications 3'))).toBe(false)
  })

  it('shows skeletons while the figures load', async () => {
    server.use(
      http.get('*/v1/admin/summary', async () => {
        await delay(300)
      }),
    )
    await renderShell()
    expect(await screen.findByRole('status', { name: 'Loading vendor figures' })).toBeInTheDocument()
  })

  it('says when the figures did not load and tries again', async () => {
    // vendor-api stays down until the admin tries again: React Query may refetch a failed query by
    // itself (on mount or reconnect), and a one-off failure would be gone before the test looks.
    let down = true
    server.use(http.get('*/v1/admin/summary', () => (down ? HttpResponse.json({ error: { code: 'unavailable', message: 'vendor-api is restarting.', request_id: 'r' } }, { status: 404 }) : undefined)))
    const { user } = await renderShell()
    // The publishing card has its own alert (a failed event in the seed), so find this one by its text.
    const alert = (await screen.findByText('Vendor figures did not load')).closest<HTMLElement>('[role="alert"]')!
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('vendor-api is restarting.')
    down = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    const card = await region('Vendors')
    expect(within(await figure(card, 'Waiting')).getByText('14')).toBeInTheDocument()
    expect(screen.queryByText('Vendor figures did not load')).toBeNull()
  })
})

describe('A-02 Home: publishing', () => {
  it('counts events by state and warns about the failed one', async () => {
    await renderShell()
    const card = await region('Publishing to the app')
    const expected = [
      ['Delivered in the last 24 h', '324'],
      ['Waiting', '2'],
      ['Retrying', '1'],
      ['Failed', '1'],
    ] as const
    for (const [label, value] of expected) expect(within(await figure(card, label)).getByText(value)).toBeInTheDocument()
    const alert = within(card).getByRole('alert')
    expect(alert).toHaveTextContent('1 event did not reach the app. It retries automatically, or you can retry it now.')
    expect(within(alert).getByRole('link', { name: 'Open publishing' })).toHaveAttribute('href', '/vendors/publishing')
    expect(headerIcon(card)).toHaveAttribute('aria-hidden', 'true')
  })

  it('links each figure to the publishing page filtered to its status', async () => {
    await renderShell()
    const card = await region('Publishing to the app')
    const expected = [
      ['Delivered in the last 24 h', 'delivered'],
      ['Waiting', 'waiting'],
      ['Retrying', 'retrying'],
      ['Failed', 'failed'],
    ] as const
    for (const [label, status] of expected) {
      const links = within(await figure(card, label)).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAttribute('href', `/vendors/publishing?status=${status}`)
      expect(links[0]!.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('opens the filtered publishing page in the module when a figure is clicked', async () => {
    const { user, router } = await renderShell()
    const card = await region('Publishing to the app')
    await user.click(within(await figure(card, 'Failed')).getByRole('link'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors/publishing'))
    expect(router.state.location.search).toBe('?status=failed')
    expect((await screen.findByTitle('Vendors')).getAttribute('src')).toBe('http://localhost:5193/publishing?status=failed')
  })

  it('opens a figure from the keyboard', async () => {
    const { user, router } = await renderShell()
    const card = await region('Publishing to the app')
    const retrying = within(await figure(card, 'Retrying')).getByRole('link')
    retrying.focus()
    expect(retrying).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.search).toBe('?status=retrying'))
  })

  it('leaves out the warning when nothing failed', async () => {
    seed((db) => {
      for (const e of db.outbox) if (e.status === 'failed') e.status = 'delivered'
    })
    await renderShell()
    const card = await region('Publishing to the app')
    const failed = await figure(card, 'Failed')
    expect(await within(failed).findByText('0')).toBeInTheDocument()
    expect(within(failed).getByText('Nothing failed')).toBeInTheDocument()
    expect(within(card).queryByRole('alert')).toBeNull()
    expect(within(card).getByRole('link', { name: 'Open publishing' })).toHaveAttribute('href', '/vendors/publishing')
  })
})

describe('A-02 Home: recent decisions', () => {
  it('lists the latest decisions with who made them and when, each opening its item', async () => {
    await renderShell()
    const card = await region('Recent decisions')
    const rows = await within(card).findAllByRole('listitem')
    const expected = [
      ['Bandhani Silk Dupatta', 'Kalki Studio', 'Approved', 'by Priya Mehta', '3 h ago', '/vendors/queue'],
      ['Ajrakh Block-Print Kurta', 'Kalki Studio', 'Sent back', 'by Priya Mehta', '10 h ago', '/vendors/queue'],
      ['Kalki Studio brand page', 'Kalki Studio', 'Approved', 'by Naman Sinha', 'Yesterday', '/vendors/review/brand/v_kalki'],
      ['Mor Pankh Clothing', 'Mor Pankh Clothing', 'Approved', 'by Rahul Desai', '6 Nov', '/vendors/vendors/v_morpankh'],
    ] as const
    expect(rows).toHaveLength(expected.length)
    expected.forEach(([title, vendor, pill, by, when, href], i) => {
      const row = rows[i]!
      // The whole row is one link: title, vendor and type, the decision, and who and when.
      const links = within(row).getAllByRole('link')
      expect(links).toHaveLength(1)
      const link = links[0]!
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAccessibleName(new RegExp(`^${title}`))
      expect(link).toHaveTextContent(vendor)
      expect(link.querySelector('[data-status]')).toHaveTextContent(pill)
      expect(link).toHaveTextContent(by)
      expect(link).toHaveTextContent(when)
      expect(semibold(within(link).getByText(title))).toBe(true)
      // A chevron closes the row.
      const chevron = link.lastElementChild!
      expect(chevron.closest('[data-status]')).toBeNull()
      expect(chevron.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })
    expect(rows[1]!.querySelector('[data-status]')).toHaveAttribute('data-status', 'sentBack')
    expect(headerIcon(card)).toHaveAttribute('aria-hidden', 'true')
  })

  it('says so when nobody has decided anything yet, with no empty rows or chevrons', async () => {
    seed((db) => {
      db.decisions.length = 0
    })
    await renderShell()
    const card = await region('Recent decisions')
    expect(await within(card).findByRole('heading', { name: 'No decisions yet' })).toBeInTheDocument()
    expect(within(card).queryAllByRole('link')).toHaveLength(0)
    expect(within(card).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('keeps a long title and vendor name inside one link', async () => {
    const long = 'Hand-block-printed Ajrakh kurta with natural indigo and madder dyes, mirror work and a contrast placket'
    seed((db) => {
      db.decisions[0]!.title = long
    })
    await renderShell()
    const card = await region('Recent decisions')
    const [first] = await within(card).findAllByRole('listitem')
    const link = within(first!).getByRole('link')
    expect(link).toHaveAccessibleName(new RegExp(`^${long}`))
    expect(getComputedStyle(within(link).getByText(long)).overflowWrap).toBe('anywhere')
  })

  it('opens a decision from anywhere on its row', async () => {
    const { user, router } = await renderShell()
    const card = await region('Recent decisions')
    const [, , brandPage] = await within(card).findAllByRole('listitem')
    await user.click(within(brandPage!).getByText('by Naman Sinha', { exact: false }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors/review/brand/v_kalki'))
  })
})

describe('#299 Home: names behind the decisions', () => {
  it('keeps the figures and says "a former admin" when identity-api cannot be reached for names', async () => {
    server.use(http.get('*/v1/admins/names', () => HttpResponse.json({ error: { code: 'unavailable', message: 'down', request_id: 'r' } }, { status: 503 })))
    await renderShell()
    const rows = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('by a former admin')
    expect(within(await figure(await region('Vendors'), 'Waiting')).getByText('14')).toBeInTheDocument()
  })

  it('says "a former admin" for a reviewer identity-api no longer knows, and keeps the others', async () => {
    server.use(
      http.get('*/v1/admins/names', ({ request }) => {
        const ids = new URL(request.url).searchParams.getAll('ids')
        // Priya (…002) is gone; the others are still there.
        return HttpResponse.json({ items: ids.filter((id) => !id.endsWith('2')).map((id) => ({ id, display_name: id.endsWith('1') ? 'Naman Sinha' : 'Rahul Desai' })) })
      }),
    )
    await renderShell()
    const rows = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('by a former admin')
    expect(rows[2]).toHaveTextContent('by Naman Sinha')
    expect(rows[3]).toHaveTextContent('by Rahul Desai')
  })

  it('keeps the names it had when a later lookup fails, rather than calling everyone "a former admin"', async () => {
    const { context } = await renderShell()
    const list = await region('Recent decisions')
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('by Priya Mehta'))
    let asked = 0
    server.use(
      http.get('*/v1/admins/names', () => {
        asked += 1
        return HttpResponse.json({ error: { code: 'unavailable', message: 'down', request_id: 'r' } }, { status: 503 })
      }),
    )
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
    await act(() => context.queryClient.refetchQueries({ queryKey: ['vendor-summary'] }))
    expect(asked).toBe(1)
    expect(context.queryClient.getQueryData<HomeSummary>(['vendor-summary'])!.recent[0]!.reviewer).toBe('Priya Mehta')
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('by Priya Mehta'))
  })

  it('looks the names up once for the refreshes of the next five minutes', async () => {
    let asked = 0
    server.use(
      http.get('*/v1/admins/names', () => {
        asked += 1
      }),
    )
    const { context } = await renderShell()
    await within(await region('Recent decisions')).findAllByRole('listitem')
    await waitFor(() => expect(asked).toBe(1))
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    await act(() => context.queryClient.refetchQueries({ queryKey: ['vendor-summary'] }))
    expect(asked).toBe(1)
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
    await act(() => context.queryClient.refetchQueries({ queryKey: ['vendor-summary'] }))
    expect(asked).toBe(2)
  })

  it('asks for each reviewer once, however many decisions they made', async () => {
    const asked: string[][] = []
    server.use(
      http.get('*/v1/admins/names', ({ request }) => {
        asked.push(new URL(request.url).searchParams.getAll('ids'))
      }),
    )
    await renderShell()
    await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(asked[0]).toHaveLength(3)
    expect(new Set(asked[0]).size).toBe(3)
  })

  it('shows a commission decision whose admin was never recorded, without asking for names', async () => {
    let asked = false
    server.use(
      http.get('*/v1/admins/names', () => {
        asked = true
      }),
      http.get('*/v1/admin/summary', () =>
        HttpResponse.json({
          waiting: { product: 0, brand_page: 0, application: 0, over_24h: 0 },
          decisions: { decided_today: 0, median_minutes: null },
          resubmissions: 0,
          commission_proposals: 0,
          publishing: { delivered_24h: 0, waiting: 0, retrying: 0, failed: 0 },
          recent: [{ id: 'commission-1', kind: 'commission', review_id: null, subject_id: 'v_kalki', title: 'Commission: Kalki Studio', vendor_id: 'v_kalki', vendor_name: 'Kalki Studio', decision: 'rejected', at: '2026-11-09T10:00:00+05:30', reviewer_id: null }],
        }),
      ),
    )
    await renderShell()
    const rows = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Commission: Kalki Studio')
    expect(rows[0]).toHaveTextContent('Sent back')
    expect(rows[0]).toHaveTextContent('by a former admin')
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/vendors/vendors/v_kalki')
    expect(asked).toBe(false)
  })

  it('shows zeros and "No decisions yet" when nothing was ever decided, with no median', async () => {
    server.use(
      http.get('*/v1/admin/summary', () =>
        HttpResponse.json({
          waiting: { product: 0, brand_page: 0, application: 0, over_24h: 0 },
          decisions: { decided_today: 0, median_minutes: null },
          resubmissions: 0,
          commission_proposals: 0,
          publishing: { delivered_24h: 0, waiting: 0, retrying: 0, failed: 0 },
          recent: [],
        }),
      ),
    )
    await renderShell()
    const card = await region('Vendors')
    expect(within(await figure(card, 'Waiting')).getByText('0')).toBeInTheDocument()
    expect(within(await region('Recent decisions')).getByRole('heading', { name: 'No decisions yet' })).toBeInTheDocument()
  })

  it('counts ten thousand waiting items as one figure', async () => {
    server.use(
      http.get('*/v1/admin/summary', () =>
        HttpResponse.json({
          waiting: { product: 9_000, brand_page: 500, application: 500, over_24h: 7_000 },
          decisions: { decided_today: 0, median_minutes: null },
          resubmissions: 0,
          commission_proposals: 0,
          publishing: { delivered_24h: 0, waiting: 0, retrying: 0, failed: 0 },
          recent: [],
        }),
      ),
    )
    await renderShell()
    const card = await region('Vendors')
    expect(within(await figure(card, 'Waiting')).getByText('10,000')).toBeInTheDocument()
    expect(within(await figure(card, 'Waiting over 24 hours')).getByText('7,000')).toBeInTheDocument()
  })
})

describe('A-02 Home: roles', () => {
  it('has no Admins card, and does not ask for the admin list', async () => {
    let asked = false
    server.use(
      http.get('*/v1/admins', () => {
        asked = true
      }),
    )
    await renderShell()
    const card = await region('Vendors')
    expect(within(await figure(card, 'Waiting')).getByText('14')).toBeInTheDocument()
    await region('Recent decisions')
    expect(screen.queryByRole('region', { name: 'Admins' })).toBeNull()
    expect(screen.queryByText('Active admins')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Manage admins' })).toBeNull()
    expect(asked).toBe(false)
  })

  it('shows a reviewer the Vendors figures without the Admins card', async () => {
    await renderShell({ as: 'priya' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Good afternoon, Priya' })).toBeInTheDocument()
    const card = await region('Vendors')
    expect(within(await figure(card, 'Waiting')).getByText('14')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Admins' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Manage admins' })).toBeNull()
  })

  it('tells an admin without module roles that there is nothing here yet', async () => {
    const { context } = await renderShell({ as: 'priya' })
    await screen.findByRole('heading', { level: 1, name: 'Good afternoon, Priya' })
    const admin = context.session.get().admin!
    act(() => context.session.adopt({ access_token: context.session.accessToken()!, expires_in: 900, admin: { ...admin, roles: [] } }))
    expect(await screen.findByRole('heading', { name: 'No modules for your role yet' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Vendors' })).toBeNull()
  })
})
