import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { mockDb, server } from '../../test/server'

// The wireframe's moment: Saturday 31 Oct 2026, 13:40 IST. The seed is built relative to it.
const NOW = new Date('2026-10-31T13:40:00+05:30')

// Changes the seed that the next renderApp creates, before any request reads it.
function seed(change: (db: MockDb) => void) {
  let changed: MockDb | null = null
  server.use(
    http.all('*/api/v1/*', () => {
      if (changed !== mockDb) {
        change(mockDb)
        changed = mockDb
      }
    }),
  )
}

const tabParam = (router: Awaited<ReturnType<typeof renderApp>>['router']) => new URLSearchParams(router.state.location.search).get('tab')
const rowOf = (region: HTMLElement, title: string) => within(region).getByRole('link', { name: title }).closest('li')!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('V-09 Review status: header and queue', () => {
  it('explains the page and counts each tab', async () => {
    await renderApp({ route: '/review' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review status' })).toBeInTheDocument()
    expect(screen.getByText('Everything you have sent to the Shazlo review team, and what they decided.')).toBeInTheDocument()
    const tabs = await screen.findByRole('tablist', { name: 'Show review items' })
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: 'All 26' })).toHaveAttribute('aria-selected', 'true'))
    expect(within(tabs).getByRole('tab', { name: 'Waiting 5' })).toHaveAttribute('aria-selected', 'false')
    expect(within(tabs).getByRole('tab', { name: 'Sent back 2' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Approved 19' })).toBeInTheDocument()
  })

  it('says how long the oldest item has waited', async () => {
    await renderApp({ route: '/review' })
    expect(await screen.findByText('Most items are reviewed within 24 hours. Your oldest waiting item has been in the queue for 30 hours.')).toBeInTheDocument()
  })

  it('drops the waiting time when nothing waits, and says the list is empty', async () => {
    seed((db) => {
      for (const p of db.products) {
        if (p.status === 'pending_review') p.status = 'draft'
        p.edit_in_review = false
      }
    })
    await renderApp({ route: '/review?tab=waiting' })
    // The sidebar count comes from the same summary as the queue time.
    expect(await screen.findByRole('link', { name: 'Review status, 0 waiting' })).toBeInTheDocument()
    expect(screen.getByText('Most items are reviewed within 24 hours.')).toBeInTheDocument()
    expect(screen.queryByText(/oldest waiting item/)).toBeNull()
    const waiting = await screen.findByRole('region', { name: 'Waiting for review' })
    expect(await within(waiting).findByRole('heading', { name: 'Nothing waiting' })).toBeInTheDocument()
    expect(within(waiting).getByText('Items you submit show up here.')).toBeInTheDocument()
  })
})

describe('V-09 Review status: lists', () => {
  it('lists waiting items with their type, submission time and wait', async () => {
    await renderApp({ route: '/review' })
    const waiting = await screen.findByRole('region', { name: 'Waiting for review' })
    await waitFor(() => expect(within(waiting).getAllByRole('listitem')).toHaveLength(5))
    expect(within(waiting).getByText('5 items')).toBeInTheDocument()

    const skirt = rowOf(waiting, 'Dabu Print Wrap Skirt')
    expect(within(skirt).getByText('Product')).toBeInTheDocument()
    expect(skirt).toHaveTextContent('Submitted yesterday, 18:40 · waiting 19 h')
    expect(within(skirt).getByText('Pending review')).toBeInTheDocument()

    const shirt = rowOf(waiting, 'Handloom Cotton Shirt — Rust')
    expect(within(shirt).getByText('Edit to a live product')).toBeInTheDocument()
    expect(shirt).toHaveTextContent('Submitted yesterday · the live version stays in the app')
    expect(within(shirt).getByText('Edit in review')).toBeInTheDocument()
    expect(within(waiting).getByRole('link', { name: 'Handloom Cotton Shirt — Rust' })).toHaveAttribute('href', '/products/p_004')
  })

  it('quotes the reason for sent-back items and links to the fix', async () => {
    await renderApp({ route: '/review' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    await waitFor(() => expect(within(decided).getAllByRole('listitem')).toHaveLength(21))

    const ajrakh = rowOf(decided, 'Ajrakh Block-Print Kurta')
    expect(ajrakh).toHaveTextContent('Sent back today, 11:40')
    expect(ajrakh).toHaveTextContent('“Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.”')
    expect(within(ajrakh).getByRole('link', { name: 'Fix and resubmit Ajrakh Block-Print Kurta' })).toHaveAttribute('href', '/products/p_001')

    const jacket = rowOf(decided, 'Kutch Mirror-Work Jacket')
    expect(jacket).toHaveTextContent('Sent back 21 Oct, 09:40')

    const dupatta = rowOf(decided, 'Bandhani Silk Dupatta')
    expect(dupatta).toHaveTextContent('Approved yesterday · live in the app')
    expect(within(dupatta).getByText('Live')).toBeInTheDocument()
    expect(within(dupatta).queryByRole('link', { name: /Fix and resubmit/ })).toBeNull()

    const coord = rowOf(decided, 'Linen Co-ord Set — Indigo')
    expect(coord).toHaveTextContent('Approved 20 Oct · publishing to the app')
    expect(within(coord).getByText('Publishing')).toBeInTheDocument()
  })

  it('sends a sent-back brand page to the brand editor', async () => {
    seed((db) => {
      db.brand.review = { state: 'rejected', at: new Date(NOW.getTime() - 3_600_000).toISOString(), reason: 'The cover photo shows another brand’s logo.' }
    })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const brand = await within(decided).findByRole('link', { name: 'Fix and resubmit Brand page' })
    expect(brand).toHaveAttribute('href', '/brand')
    expect(decided).toHaveTextContent('“The cover photo shows another brand’s logo.”')
  })
})

describe('V-09 Review status: tabs', () => {
  it('keeps the chosen tab in the address and shows only its list', async () => {
    const { user, router } = await renderApp({ route: '/review' })
    await screen.findByRole('tab', { name: 'Waiting 5' })

    await user.click(screen.getByRole('tab', { name: 'Waiting 5' }))
    expect(tabParam(router)).toBe('waiting')
    expect(screen.getByRole('tab', { name: 'Waiting 5' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('region', { name: 'Waiting for review' })).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('region', { name: 'Recently decided' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Sent back 2' }))
    expect(tabParam(router)).toBe('rejected')
    expect(screen.queryByRole('region', { name: 'Waiting for review' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Recently decided' })).getAllByRole('listitem')).toHaveLength(2)

    await user.click(screen.getByRole('tab', { name: 'Approved 19' }))
    expect(tabParam(router)).toBe('approved')
    const approved = screen.getByRole('region', { name: 'Recently decided' })
    expect(within(approved).getAllByRole('listitem')).toHaveLength(19)
    expect(within(approved).queryByText('Sent back')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'All 26' }))
    expect(tabParam(router)).toBeNull()
    expect(screen.getByRole('region', { name: 'Waiting for review' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recently decided' })).toBeInTheDocument()
  })

  it('opens on the tab named in the link', async () => {
    await renderApp({ route: '/review?tab=rejected' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sent back 2' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('tabpanel', { name: 'Sent back 2' })).toBeInTheDocument()
    const decided = screen.getByRole('region', { name: 'Recently decided' })
    expect(within(decided).getAllByRole('listitem')).toHaveLength(2)
  })

  it('treats an unknown tab as All', async () => {
    await renderApp({ route: '/review?tab=everything' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All 26' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('says so when nothing was sent back', async () => {
    seed((db) => {
      for (const p of db.products) if (p.status === 'rejected') p.status = 'approved'
    })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    expect(await within(decided).findByRole('heading', { name: 'Nothing sent back' })).toBeInTheDocument()
  })

  it('points a new seller to their first product when nothing has been sent', async () => {
    seed((db) => {
      db.products = []
      db.brand = { live: null, live_since: null, draft: null, draft_saved_at: null, review: { state: 'none' }, submitted_at: null }
    })
    await renderApp({ route: '/review' })
    expect(await screen.findByRole('heading', { name: 'Nothing sent for review yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('region', { name: 'How review works' })).toBeInTheDocument()
  })
})

describe('V-09 Review status: explainer, states and layout', () => {
  it('explains the three review steps and what the team checks', async () => {
    await renderApp({ route: '/review' })
    const how = await screen.findByRole('region', { name: 'How review works' })
    const steps = within(how).getAllByRole('list')[0]!
    expect(within(steps).getAllByRole('listitem').map((li) => li.querySelector('h3')?.textContent)).toEqual(['Submitted', 'Reviewed', 'Live or sent back'])
    expect(steps).toHaveTextContent('Your item joins the queue. You can still see it, but not edit it.')
    expect(within(how).getByRole('heading', { name: 'What we check' })).toBeInTheDocument()
    for (const check of ['Front, back and close-up photos', 'Price matches the tag (MRP)', 'Category and fabric are right', 'Nothing on the prohibited list']) {
      expect(within(how).getByText(check)).toBeInTheDocument()
    }
  })

  it('shows a skeleton while the items load', async () => {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    server.use(
      http.get('*/api/v1/vendor/reviews', async () => {
        await gate
      }),
    )
    await renderApp({ route: '/review' })
    expect(await screen.findByRole('status', { name: 'Loading review items' })).toBeInTheDocument()
    open()
    expect(await screen.findByRole('region', { name: 'Recently decided' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading review items' })).toBeNull()
  })

  it('explains when the items do not load, and tries again', async () => {
    let down = true
    server.use(http.get('*/api/v1/vendor/reviews', () => (down ? HttpResponse.json({ message: 'Down', extra: { code: 'server_error' } }, { status: 500 }) : undefined)))
    const { user } = await renderApp({ route: '/review' })
    // The query client retries a 500 twice (about 3 s) before giving up.
    const alert = await screen.findByRole('alert', {}, { timeout: 8000 })
    expect(alert).toHaveTextContent('Your review items did not load. Check your connection and try again.')
    down = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Recently decided' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('puts the lists and the explainer side by side on desktop', async () => {
    await renderApp({ route: '/review' })
    const how = await screen.findByRole('region', { name: 'How review works' })
    expect(how.parentElement!.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' })
  })

  it('stacks the explainer after the lists on phones', async () => {
    await renderApp({ route: '/review', viewport: 'mobile' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const how = screen.getByRole('region', { name: 'How review works' })
    expect(decided.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(how.parentElement!.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)' })
  })
})
