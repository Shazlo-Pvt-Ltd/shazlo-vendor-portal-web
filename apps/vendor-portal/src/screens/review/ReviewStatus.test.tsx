import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_STAFF, nextId, type MockDb } from '../../mocks/db'
import { decide } from '../../mocks/handlers'
import { renderApp } from '../../test/render'
import { server, setupMockApi } from '../../test/server'
import { resetLastVisit } from './lastVisit'

// The wireframe's moment: Saturday 31 Oct 2026, 13:40 IST. The seed is built relative to it, and the
// mock's clock follows the (faked) system time, so a test can let time pass before a decision.
const NOW = new Date('2026-10-31T13:40:00+05:30')
const MINUTE = 60_000

// Before setupMockApi(), so the seed is made at NOW.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetLastVisit()
})
afterEach(() => {
  vi.useRealTimers()
})

const { db } = setupMockApi({ now: () => new Date() })

const kalki = () => db().vendors.find((v) => v.name === 'Kalki Studio')!
const bySku = (sku: string) => db().products.find((p) => p.sku === sku)!
const tabParam = (router: Awaited<ReturnType<typeof renderApp>>['router']) => new URLSearchParams(router.state.location.search).get('tab')
const rowOf = (region: HTMLElement, title: string) => within(region).getByRole('link', { name: title }).closest('li')!

/** The draft brand page goes to review, as POST /brand-profile/submit would send it. */
function sendBrandPageForReview(d: MockDb, minutesAgo: number) {
  const at = new Date(Date.now() - minutesAgo * MINUTE).toISOString()
  const draft = d.brands.get(kalki().id)!.find((v) => v.state === 'draft')!
  Object.assign(draft, { state: 'pending_review', submitted_at: at })
  d.submissions.push({ id: nextId(d), vendor_id: kalki().id, subject: 'brand_profile', product_id: null, sku: null, title: null, version: draft.version, status: 'pending', reason: null, submitted_at: at, decided_at: null })
}

/** A sent-back product fixed and sent again. */
function resubmit(d: MockDb, sku: string) {
  const product = bySku(sku)
  product.working!.state = 'in_review'
  product.working!.version += 1
  product.status = 'pending_review'
  d.submissions.push({ id: nextId(d), vendor_id: kalki().id, subject: 'product', product_id: product.id, sku, title: product.working!.content.title, version: product.working!.version, status: 'pending', reason: null, submitted_at: new Date(Date.now() - 30 * MINUTE).toISOString(), decided_at: null })
}

// Load the lazily imported screen once up front, so the first tests do not time out while the
// chunk is transformed.
beforeAll(async () => {
  await import('./ReviewStatus')
})

describe('V-09 Review status: header and queue', () => {
  it('explains the page and counts each tab', async () => {
    await renderApp({ route: '/review' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review status' }, { timeout: 5000 })).toBeInTheDocument()
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
    db().submissions = db().submissions.filter((s) => s.status !== 'pending')
    await renderApp({ route: '/review?tab=waiting' })
    // The sidebar count comes from the same summary as the queue time.
    expect(await screen.findByRole('link', { name: /^Review status\s*, 0 waiting$/ }, { timeout: 5000 })).toBeInTheDocument()
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
    expect(within(waiting).getByRole('link', { name: 'Handloom Cotton Shirt — Rust' })).toHaveAttribute('href', `/products/${bySku('KS-HCS-003').id}`)
  })

  it('quotes the reason for sent-back items and links to the fix', async () => {
    await renderApp({ route: '/review' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    await waitFor(() => expect(within(decided).getAllByRole('listitem')).toHaveLength(21))

    const ajrakh = rowOf(decided, 'Ajrakh Block-Print Kurta')
    expect(ajrakh).toHaveTextContent('Sent back today, 11:40')
    expect(ajrakh).toHaveTextContent(/“Back photo is missing.*”/)
    expect(within(ajrakh).getByRole('link', { name: 'Fix and resubmit Ajrakh Block-Print Kurta' })).toHaveAttribute('href', `/products/${bySku('KS-AJR-014').id}`)

    const jacket = rowOf(decided, 'Kutch Mirror-Work Jacket')
    expect(jacket).toHaveTextContent('Sent back 21 Oct, 09:40')

    const dupatta = rowOf(decided, 'Bandhani Silk Dupatta')
    expect(dupatta).toHaveTextContent('Approved yesterday · live in the app')
    expect(within(dupatta).getByText('Live')).toBeInTheDocument()
    expect(within(dupatta).queryByRole('link', { name: /Fix and resubmit/ })).toBeNull()

    // vendor-api has no "publishing" state: an approved product is live.
    const coord = rowOf(decided, 'Linen Co-ord Set — Indigo')
    expect(coord).toHaveTextContent('Approved 20 Oct · live in the app')
  })

  it('sends a sent-back brand page to the brand editor', async () => {
    sendBrandPageForReview(db(), 90)
    decide(db(), { brandOf: kalki().id }, { approve: false, reason: 'The cover photo shows another brand’s logo.' })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const brand = await within(decided).findByRole('link', { name: 'Fix and resubmit Brand page' })
    expect(brand).toHaveAttribute('href', '/brand')
    expect(decided).toHaveTextContent('“The cover photo shows another brand’s logo.”')
  })

  it('finds the product by its code when vendor-api does not name it', async () => {
    db().proposals.submissionProductIds = false
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    expect(await within(decided).findByRole('link', { name: 'Fix and resubmit Ajrakh Block-Print Kurta' })).toHaveAttribute('href', `/products/${bySku('KS-AJR-014').id}`)
  })

  it('sends a product it cannot find to Products, not to a broken address', async () => {
    db().proposals.submissionProductIds = false
    db().submissions.push({ id: nextId(db()), vendor_id: kalki().id, subject: 'product', product_id: null, sku: 'KS-OLD-001', title: 'Old kurta', version: 1, status: 'rejected', reason: 'Blurry.', submitted_at: new Date(NOW.getTime() - 60 * MINUTE).toISOString(), decided_at: new Date(NOW.getTime() - 30 * MINUTE).toISOString() })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    expect(await within(decided).findByRole('link', { name: 'Fix and resubmit Old kurta' })).toHaveAttribute('href', '/products')
  })

  it('shows a reason exactly as written: line breaks kept, markup as text', async () => {
    const product = bySku('KS-DAB-040')
    decide(db(), { productId: product.id }, { approve: false, reason: 'Two things:\n1. Steam the skirt.\n2. <b>Retake</b> the back photo.' })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const row = await waitFor(() => rowOf(decided, 'Dabu Print Wrap Skirt'))
    const reason = within(row).getByText(/Two things:/)
    expect(reason).toHaveTextContent('2. <b>Retake</b> the back photo.')
    expect(reason).toHaveStyle({ whiteSpace: 'pre-line' })
    expect(row.querySelector('b')).toBeNull()
  })

  it('says so when a sent-back item came with no reason', async () => {
    decide(db(), { productId: bySku('KS-DAB-040').id }, { approve: false })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const row = await waitFor(() => rowOf(decided, 'Dabu Print Wrap Skirt'))
    expect(row).toHaveTextContent('No reason was given. Write to partners@shazlo.store if it is not clear what to change.')
  })

  it('says a sent-back change to a live product left the live version on sale', async () => {
    decide(db(), { productId: bySku('KS-HCS-003').id }, { approve: false, reason: 'The new price is below your MRP rule.' })
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const row = await waitFor(() => rowOf(decided, 'Handloom Cotton Shirt — Rust'))
    expect(row).toHaveTextContent('The live version is unchanged: shoppers still see it.')
  })

  it('does not ask to fix an item that was already sent again', async () => {
    resubmit(db(), 'KS-AJR-014')
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    const row = await waitFor(() => rowOf(decided, 'Ajrakh Block-Print Kurta'))
    expect(row).toHaveTextContent('You sent a newer version after this one.')
    expect(within(row).queryByRole('link', { name: /Fix and resubmit/ })).toBeNull()
    // The other sent-back product still needs its fix.
    expect(within(rowOf(decided, 'Kutch Mirror-Work Jacket')).getByRole('link', { name: /Fix and resubmit/ })).toBeInTheDocument()
  })

  it('keeps long and non-Latin titles inside the row', async () => {
    const title = 'हाथ से छपा अजरख कुर्ता — '.repeat(8).trim()
    db().submissions.find((s) => s.sku === 'KS-AJR-014')!.title = title
    await renderApp({ route: '/review?tab=rejected' })
    const link = await screen.findByRole('link', { name: title })
    expect(link).toHaveStyle({ overflowWrap: 'anywhere' })
  })
})

describe('V-09 Review status: what is new', () => {
  const sidebar = () => screen.getByRole('navigation', { name: 'Seller sections' })

  it('marks decisions made since the last visit, and none on the first visit after signing in', async () => {
    const { user } = await renderApp({ route: '/review' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    await waitFor(() => expect(within(decided).getAllByRole('listitem')).toHaveLength(21))
    expect(screen.queryByText('New since your last visit')).toBeNull()

    await user.click(within(sidebar()).getByRole('link', { name: 'Overview' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    vi.setSystemTime(NOW.getTime() + 10 * MINUTE)
    decide(db(), { productId: bySku('KS-DAB-040').id }, { approve: true })
    decide(db(), { productId: bySku('KS-PIK-027').id }, { approve: false, reason: 'Show the dupatta too.' })

    await user.click(within(sidebar()).getByRole('link', { name: /^Review status/ }))
    const again = await screen.findByRole('region', { name: 'Recently decided' })
    await waitFor(() => expect(within(again).getAllByText('New since your last visit')).toHaveLength(2))
    expect(within(rowOf(again, 'Dabu Print Wrap Skirt')).getByText('New since your last visit')).toBeInTheDocument()
    expect(within(rowOf(again, 'Pochampally Ikat Kurta')).getByText('New since your last visit')).toBeInTheDocument()
    expect(within(rowOf(again, 'Bandhani Silk Dupatta')).queryByText('New since your last visit')).toBeNull()
  })

  it('marks decisions made after signing in on the first visit', async () => {
    const { user } = await renderApp({ route: '/' })
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    vi.setSystemTime(NOW.getTime() + 5 * MINUTE)
    decide(db(), { productId: bySku('KS-DAB-040').id }, { approve: true })
    await user.click(within(sidebar()).getByRole('link', { name: /^Review status/ }))
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    await waitFor(() => expect(within(rowOf(decided, 'Dabu Print Wrap Skirt')).getByText('New since your last visit')).toBeInTheDocument())
  })

  it('reads out a decision that arrives while the page is open', async () => {
    const { queryClient } = await renderApp({ route: '/review' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    await waitFor(() => expect(within(decided).getAllByRole('listitem')).toHaveLength(21))
    const live = screen.getByTestId('review-announcer')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toBeEmptyDOMElement()

    vi.setSystemTime(NOW.getTime() + MINUTE)
    decide(db(), { productId: bySku('KS-DAB-040').id }, { approve: true })
    await act(() => queryClient.invalidateQueries({ queryKey: ['reviews'] }))
    await waitFor(() => expect(live).toHaveTextContent('Status updated. Dabu Print Wrap Skirt: approved.'))
  })

  it('looks again every minute while the page is open', async () => {
    const intervals: number[] = []
    const real = window.setInterval
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      intervals.push(ms ?? 0)
      return real(fn, ms)
    }) as typeof window.setInterval)
    await renderApp({ route: '/review' })
    await screen.findByRole('region', { name: 'Recently decided' })
    expect(intervals).toContain(60_000)
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
    db().submissions = db().submissions.filter((s) => s.status !== 'rejected')
    await renderApp({ route: '/review?tab=rejected' })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    expect(await within(decided).findByRole('heading', { name: 'Nothing sent back' })).toBeInTheDocument()
  })

  it('points a new seller to their first product when nothing has been sent', async () => {
    db().submissions = db().submissions.filter((s) => s.vendor_id !== kalki().id)
    await renderApp({ route: '/review' })
    expect(await screen.findByRole('heading', { name: 'Nothing sent for review yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('region', { name: 'How review works' })).toBeInTheDocument()
  })

  it('works the same for staff', async () => {
    await renderApp({ route: '/review?tab=rejected', credentials: DEMO_STAFF })
    const decided = await screen.findByRole('region', { name: 'Recently decided' })
    expect(await within(decided).findByRole('link', { name: 'Fix and resubmit Ajrakh Block-Print Kurta' })).toBeInTheDocument()
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
      http.get('*/v1/vendor/submissions', async () => {
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
    server.use(http.get('*/v1/vendor/submissions', () => (down ? HttpResponse.json({ error: { code: 'internal_error', message: 'Down' } }, { status: 500 }) : undefined)))
    const { user } = await renderApp({ route: '/review' })
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
