import type { MockVendorApi } from '@shazlo/mock-vendor-api'
import { act, screen, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    http.all('*/api/v1/*', () => {
      change(mocks.vendorDb)
    }),
  )
}

const region = (name: string) => screen.findByRole('region', { name })

const figure = (card: HTMLElement, label: string) => within(card).findByRole('group', { name: label })

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

  it('shows skeletons while the figures load', async () => {
    server.use(
      http.get('*/api/v1/admin/summary', async () => {
        await delay(300)
      }),
    )
    await renderShell()
    expect(await screen.findByRole('status', { name: 'Loading vendor figures' })).toBeInTheDocument()
  })

  it('says when the figures did not load and tries again', async () => {
    server.use(http.get('*/api/v1/admin/summary', () => HttpResponse.json({ message: 'vendor-api is restarting.', extra: { code: 'unavailable' } }, { status: 404 }), { once: true }))
    const { user } = await renderShell()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Vendor figures did not load')
    expect(alert).toHaveTextContent('vendor-api is restarting.')
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
      expect(within(row).getByRole('link', { name: title })).toHaveAttribute('href', href)
      expect(row).toHaveTextContent(vendor)
      expect(row.querySelector('[data-status]')).toHaveTextContent(pill)
      expect(row).toHaveTextContent(by)
      expect(row).toHaveTextContent(when)
    })
    expect(rows[1]!.querySelector('[data-status]')).toHaveAttribute('data-status', 'sentBack')
  })
})

describe('A-02 Home: admins', () => {
  it('shows super admins how many admins are active and who has not set a password', async () => {
    await renderShell()
    const card = await region('Admins')
    const active = await figure(card, 'Active admins')
    expect(await within(active).findByText('4')).toBeInTheDocument()
    expect(within(active).getByText('1 invited admin has not set a password yet')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Manage admins' })).toHaveAttribute('href', '/admins')
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
