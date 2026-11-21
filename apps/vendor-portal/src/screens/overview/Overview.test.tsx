import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextId } from '../../mocks/db'
import { decide } from '../../mocks/handlers'
import { renderApp } from '../../test/render'
import { server, setupMockApi } from '../../test/server'
import { addNewSeller, kalkiOf, NEW_SELLER } from './testing'

// The wireframe's moment: Saturday 31 Oct 2026, 13:40 IST. The seed is built relative to it.
const NOW = new Date('2026-10-31T13:40:00+05:30')
const H = 3_600_000

// Load the lazily imported screens once up front, so the first test does not time out while
// the chunk is transformed.
beforeAll(async () => {
  await import('./Overview')
})

// Before setupMockApi(), so the seed is made at NOW.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

const { db } = setupMockApi({ now: () => new Date() })
const bySku = (sku: string) => db().products.find((p) => p.sku === sku)!

describe('V-04 Overview: header', () => {
  it('names the store and offers both ways to add products', async () => {
    await renderApp()
    const main = await screen.findByRole('main')
    expect(await within(main).findByRole('heading', { level: 1, name: 'Overview' }, { timeout: 5000 })).toBeInTheDocument()
    // vendor-api does not say when a brand was approved, so the subtitle is the store's name.
    expect(await within(main).findByText('Kalki Studio')).toBeInTheDocument()
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
    bySku('KS-KMJ-007').status = 'approved'
    await renderApp()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('1 product was sent back by the review team')
    expect(alert).toHaveTextContent('Fix the notes on it and resubmit. It stays off the app until approved.')
  })

  it('stays away when nothing is sent back', async () => {
    for (const p of db().products) if (p.status === 'rejected') p.status = 'approved'
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

  // Phones get their own Home (PhoneHome.test.tsx); tablets keep these figures.
  it('sets the figures two by two and stacks the cards on tablets', async () => {
    await renderApp({ viewport: 'tablet' })
    const figures = await screen.findByRole('region', { name: 'Your products at a glance' })
    expect(figures).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    const decisions = await screen.findByRole('region', { name: 'Recent review decisions' })
    const brand = screen.getByRole('region', { name: 'Brand page' })
    expect(decisions.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)' })
    expect(decisions.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('explains when the counts do not load, and tries again', async () => {
    let down = true
    server.use(http.get('*/v1/vendor/products', () => (down ? HttpResponse.json({ error: { code: 'internal_error', message: 'Down' } }, { status: 500 }) : undefined)))
    const { user } = await renderApp()
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
  it('lists the five latest decisions, newest first, with the reviewer note on sent-back items', async () => {
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Recent review decisions' })
    const rows = await within(card).findAllByRole('listitem')
    expect(rows).toHaveLength(5)
    const [ajrakh, bandhani, shirt, jacket, coord] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement]

    expect(within(ajrakh).getByRole('link', { name: 'Ajrakh Block-Print Kurta' })).toHaveAttribute('href', `/products/${bySku('KS-AJR-014').id}`)
    expect(within(ajrakh).getByText('KS-AJR-014')).toBeInTheDocument()
    expect(ajrakh).toHaveTextContent(/“Back photo is missing.*”/)
    expect(within(ajrakh).getByText('Sent back')).toBeInTheDocument()
    expect(within(ajrakh).getByText('2 h ago')).toBeInTheDocument()

    expect(within(bandhani).getByRole('link', { name: 'Bandhani Silk Dupatta' })).toHaveAttribute('href', `/products/${bySku('KS-BDN-022').id}`)
    expect(within(bandhani).getByText('Live')).toBeInTheDocument()
    expect(within(bandhani).getByText('Yesterday')).toBeInTheDocument()

    expect(within(shirt).getByRole('link', { name: 'Handloom Cotton Shirt — Rust' })).toHaveAttribute('href', `/products/${bySku('KS-HCS-003').id}`)

    expect(within(jacket).getByRole('link', { name: 'Kutch Mirror-Work Jacket' })).toHaveAttribute('href', `/products/${bySku('KS-KMJ-007').id}`)
    expect(jacket).toHaveTextContent('“Price ₹3,999 does not match the MRP on the tag (₹3,499).”')
    expect(within(jacket).getByText('21 Oct')).toBeInTheDocument()
    expect(within(coord).getByRole('link', { name: 'Linen Co-ord Set — Indigo' })).toBeInTheDocument()

    expect(within(card).getByRole('link', { name: 'View all review decisions' })).toHaveAttribute('href', '/review')
  })

  it('puts the newest decision first, even on an older submission', async () => {
    decide(db(), { productId: bySku('KS-BGR-033').id }, { approve: true })
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Recent review decisions' })
    const rows = await within(card).findAllByRole('listitem')
    expect(within(rows[0]!).getByRole('link', { name: 'Bagru Print Palazzo' })).toBeInTheDocument()
    expect(within(rows[1]!).getByRole('link', { name: 'Ajrakh Block-Print Kurta' })).toBeInTheDocument()
  })

  it('shows a brand page decision and links it to the brand editor', async () => {
    const at = new Date(NOW.getTime() - H).toISOString()
    db().submissions.push({ id: nextId(db()), vendor_id: kalkiOf(db()).id, subject: 'brand_profile', product_id: null, was_live: false, sku: null, title: null, version: 2, status: 'rejected', reason: 'Cover is blurry.', submitted_at: at, decided_at: at })
    await renderApp()
    const card = await screen.findByRole('region', { name: 'Recent review decisions' })
    const brand = await within(card).findByRole('link', { name: 'Brand page' })
    expect(brand).toHaveAttribute('href', '/brand')
    expect(brand.closest('li')).toHaveTextContent('“Cover is blurry.”')
  })

  it('welcomes a brand-new seller: zeros and first steps, never an error', async () => {
    addNewSeller(db())
    await renderApp({ credentials: NEW_SELLER })
    const card = await screen.findByRole('region', { name: 'Recent review decisions' })
    expect(await within(card).findByRole('heading', { name: 'Nothing reviewed yet' })).toBeInTheDocument()
    expect(within(card).getByText('Most products are reviewed within a day')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    for (const label of ['Live on Shazlo', 'Pending review', 'Sent back', 'Drafts']) {
      expect(await within(screen.getByRole('group', { name: label })).findByText('0')).toBeInTheDocument()
    }
    expect(within(screen.getByRole('group', { name: 'Sent back' })).getByText('Nothing to fix')).toBeInTheDocument()

    const brand = screen.getByRole('region', { name: 'Brand page' })
    expect(await within(brand).findByText('Not published yet. Shoppers see your brand page next to every product.')).toBeInTheDocument()
    // The first steps, store details first.
    expect(await screen.findByText('0 of 3 set up')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Finish your store details' })).toHaveAttribute('href', '/store/details')
    // Waiting for Shazlo's approval, said once, on Home.
    expect(screen.getByText(/Your application is in review/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0))
    expect(screen.queryByText(/did not load/)).toBeNull()
  })

  it('keeps working on a vendor-api without the store details routes', async () => {
    server.use(http.get('*/v1/vendor/store-details', () => HttpResponse.json({ detail: 'Not Found' }, { status: 404 })))
    await renderApp()
    const live = await screen.findByRole('group', { name: 'Live on Shazlo' })
    expect(await within(live).findByText('18')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Recent review decisions' })).toBeInTheDocument()
    expect(screen.queryByText(/did not load/)).toBeNull()
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
    const at = new Date(NOW.getTime() - 20 * H).toISOString()
    const kalki = kalkiOf(db())
    const draft = db().brands.get(kalki.id)!.find((v) => v.state === 'draft')!
    Object.assign(draft, { state: 'pending_review', submitted_at: at })
    db().submissions.push({ id: nextId(db()), vendor_id: kalki.id, subject: 'brand_profile', product_id: null, was_live: false, sku: null, title: null, version: draft.version, status: 'pending', reason: null, submitted_at: at, decided_at: null })
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
      http.get('*/v1/vendor/brand-profile', async () => {
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
