import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { mockDb, server } from '../../test/server'

// The wireframe's moment: Saturday 31 Oct 2026, 13:40 IST. The seed is built relative to it.
const NOW = new Date('2026-10-31T13:40:00+05:30')
const H = 3_600_000

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('V-04 Overview: header', () => {
  it('names the store, says since when it sells, and offers both ways to add products', async () => {
    await renderApp()
    const main = screen.getByRole('main')
    expect(await within(main).findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(await within(main).findByText('Kalki Studio · approved seller since 14 Oct 2026')).toBeInTheDocument()
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveAttribute('href', '/products/import')
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
  })
})

describe('V-04 Overview: sent-back banner', () => {
  it('warns about sent-back products and links to the feedback', async () => {
    await renderApp()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('2 products were sent back by the review team')
    expect(alert).toHaveTextContent('Fix the notes on each product and resubmit. They stay off the app until approved.')
    expect(within(alert).getByRole('link', { name: 'See feedback' })).toHaveAttribute('href', '/review?tab=rejected')
  })

  it('speaks of one product when only one was sent back', async () => {
    seed((db) => {
      db.products.find((p) => p.sku === 'KS-KMJ-007')!.status = 'approved'
    })
    await renderApp()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('1 product was sent back by the review team')
    expect(alert).toHaveTextContent('Fix the notes on it and resubmit. It stays off the app until approved.')
  })

  it('stays away when nothing is sent back', async () => {
    seed((db) => {
      for (const p of db.products) if (p.status === 'rejected') p.status = 'approved'
    })
    await renderApp()
    const sentBack = await screen.findByRole('group', { name: 'Sent back' })
    expect(await within(sentBack).findByText('0')).toBeInTheDocument()
    expect(within(sentBack).getByText('Nothing to fix')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('V-04 Overview: figures', () => {
  it('counts products by status, each linking to the filtered list', async () => {
    await renderApp()
    const expected = [
      ['Live on Shazlo', '18', 'Visible in the app feed', '/products?status=approved'],
      ['Pending review', '4', 'Usually reviewed within 24 h', '/products?status=pending_review'],
      ['Sent back', '2', 'Needs your changes', '/products?status=rejected'],
      ['Drafts', '3', 'Not submitted yet', '/products?status=draft'],
    ] as const
    for (const [label, value, baseline, href] of expected) {
      const figure = await screen.findByRole('group', { name: label })
      expect(await within(figure).findByText(value)).toBeInTheDocument()
      expect(within(figure).getByText(baseline)).toBeInTheDocument()
      expect(within(figure).getByRole('link')).toHaveAttribute('href', href)
    }
  })

  it('sets four figures across and the cards in two columns on desktop', async () => {
    await renderApp()
    const figures = await screen.findByRole('region', { name: 'Your products at a glance' })
    expect(figures).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' })
    const decisions = await screen.findByRole('region', { name: 'Recent review decisions' })
    expect(decisions.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' })
  })

  it('sets the figures two by two and stacks the cards on phones', async () => {
    await renderApp({ viewport: 'mobile' })
    const figures = await screen.findByRole('region', { name: 'Your products at a glance' })
    expect(figures).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    const decisions = await screen.findByRole('region', { name: 'Recent review decisions' })
    const brand = screen.getByRole('region', { name: 'Brand page' })
    expect(decisions.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)' })
    expect(decisions.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('explains when the counts do not load, and tries again', async () => {
    let down = true
    server.use(http.get('*/api/v1/vendor/summary', () => (down ? HttpResponse.json({ message: 'Down', extra: { code: 'server_error' } }, { status: 500 }) : undefined)))
    const { user } = await renderApp()
    // The query client retries a 500 twice (about 3 s) before giving up.
    const alert = await screen.findByRole('alert', {}, { timeout: 8000 })
    expect(alert).toHaveTextContent('Your product counts did not load. Check your connection and try again.')
    down = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    const live = await screen.findByRole('group', { name: 'Live on Shazlo' })
    expect(await within(live).findByText('18')).toBeInTheDocument()
    expect(screen.queryByText(/counts did not load/)).toBeNull()
  })
})

describe('V-04 Overview: recent review decisions', () => {
  it('lists the five latest decisions with the reviewer note on sent-back items', async () => {
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Recent review decisions' })
    const rows = await within(card).findAllByRole('listitem')
    expect(rows).toHaveLength(5)
    const [ajrakh, bandhani, brand, shirt, jacket] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement]

    expect(within(ajrakh).getByRole('link', { name: 'Ajrakh Block-Print Kurta' })).toHaveAttribute('href', '/products/p_001')
    expect(within(ajrakh).getByText('KS-AJR-014')).toBeInTheDocument()
    expect(ajrakh).toHaveTextContent('“Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.”')
    expect(within(ajrakh).getByText('Sent back')).toBeInTheDocument()
    expect(within(ajrakh).getByText('2 h ago')).toBeInTheDocument()

    expect(within(bandhani).getByRole('link', { name: 'Bandhani Silk Dupatta' })).toHaveAttribute('href', '/products/p_003')
    expect(within(bandhani).getByText('Live')).toBeInTheDocument()
    expect(within(bandhani).getByText('Yesterday')).toBeInTheDocument()

    expect(within(brand).getByRole('link', { name: 'Brand page' })).toHaveAttribute('href', '/brand')
    expect(within(shirt).getByRole('link', { name: 'Handloom Cotton Shirt — Rust' })).toHaveAttribute('href', '/products/p_004')

    expect(within(jacket).getByRole('link', { name: 'Kutch Mirror-Work Jacket' })).toHaveAttribute('href', '/products/p_002')
    expect(jacket).toHaveTextContent('“Price ₹3,999 does not match the MRP on the tag (₹3,499).”')
    expect(within(jacket).getByText('21 Oct')).toBeInTheDocument()

    expect(within(card).getByRole('link', { name: 'View all review decisions' })).toHaveAttribute('href', '/review')
  })

  it('welcomes a brand-new seller with nothing reviewed yet', async () => {
    seed((db) => {
      db.products = []
      db.brand = { live: null, live_since: null, draft: null, draft_saved_at: null, review: { state: 'none' }, submitted_at: null }
    })
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Recent review decisions' })
    expect(await within(card).findByRole('heading', { name: 'Nothing reviewed yet' })).toBeInTheDocument()
    expect(within(card).getByText('Most products are reviewed within a day')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    const live = screen.getByRole('group', { name: 'Live on Shazlo' })
    expect(await within(live).findByText('0')).toBeInTheDocument()

    const brand = screen.getByRole('region', { name: 'Brand page' })
    expect(await within(brand).findByText('Not published yet. Shoppers see your brand page next to every product.')).toBeInTheDocument()
    expect(within(brand).getByRole('link', { name: 'Set up brand page' })).toHaveAttribute('href', '/brand')
  })
})

describe('V-04 Overview: brand page card', () => {
  it('shows the live page and the unpublished draft', async () => {
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Brand page' })
    expect(await within(card).findByText('Published 20 Oct.')).toBeInTheDocument()
    expect(within(card).getByText('Live')).toBeInTheDocument()
    expect(within(card).getByText('You have a draft with 2 unpublished changes (cover image, story).')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Edit brand page' })).toHaveAttribute('href', '/brand')
  })

  it('says when the brand page has been in review since', async () => {
    seed((db) => {
      const at = new Date(NOW.getTime() - 20 * H).toISOString()
      db.brand.review = { state: 'waiting', at }
      db.brand.submitted_at = at
    })
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Brand page' })
    expect(await within(card).findByText('In review since yesterday, 17:40.')).toBeInTheDocument()
    expect(within(card).getByText('Edit in review')).toBeInTheDocument()
    expect(within(card).queryByText(/You have a draft/)).toBeNull()
  })

  it('shows a skeleton until the brand page loads', async () => {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    server.use(
      http.get('*/api/v1/vendor/brand-page', async () => {
        await gate
      }),
    )
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Brand page' })
    expect(within(card).getByRole('status', { name: 'Loading your brand page' })).toBeInTheDocument()
    open()
    expect(await within(card).findByText('Published 20 Oct.')).toBeInTheDocument()
    expect(within(card).queryByRole('status')).toBeNull()
  })
})
