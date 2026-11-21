import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { makeStore, sessionBody } from '../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'
import { setViewport } from '../test/viewport'

const server = useApiServer()

interface Counts {
  draft?: number
  pending_review?: number
  approved?: number
  rejected?: number
}

function productsHandler(counts: Counts, seen: string[] = []) {
  return http.get(`${BASE}/v1/vendor/products`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? 'none'
    seen.push(`${status}:${url.searchParams.get('limit')}`)
    return HttpResponse.json({ items: [], total: counts[status as keyof Counts] ?? 0, limit: 1, offset: 0 })
  })
}

/**
 * The brand page as the API really answers: the draft always has `state: 'draft'`, a version waiting for a
 * decision is `in_review_version`, and `/published` is a 404 until the first approval.
 */
function brandHandlers(options: { inReview?: number; publishedAt?: string } = {}) {
  return [
    http.get(`${BASE}/v1/vendor/brand-profile`, () =>
      HttpResponse.json({ state: 'draft', published_at: null, in_review_version: options.inReview ?? null }),
    ),
    http.get(`${BASE}/v1/vendor/brand-profile/published`, () =>
      options.publishedAt
        ? HttpResponse.json({ state: 'published', published_at: options.publishedAt })
        : apiErrorResponse(404, 'no_published_profile'),
    ),
  ]
}

type SubmissionItem = Record<string, unknown>

/** The submissions list: `status=pending` answers `pending` as its total; any other query answers `items`. */
function submissionsHandler(pending = 0, items: SubmissionItem[] = []) {
  return http.get(`${BASE}/v1/vendor/submissions`, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')
    return status === 'pending'
      ? HttpResponse.json({ items: [], total: pending, limit: 1, offset: 0 })
      : HttpResponse.json({ items, total: items.length, limit: 10, offset: 0 })
  })
}

const decision = (overrides: SubmissionItem): SubmissionItem => ({
  subject: 'product',
  id: 'p1',
  sku: 'KRT-1',
  title: 'Indigo kurta',
  version: 1,
  status: 'approved',
  reason: null,
  submitted_at: '2026-11-10T09:00:00Z',
  decided_at: '2026-11-11T09:00:00Z',
  ...overrides,
})

async function open(role = 'owner') {
  setViewport(1280)
  const store = makeStore({ refresh: async () => sessionBody({ role }) }).store
  renderRoute('/', { store })
  await screen.findByRole('heading', { level: 1, name: 'Overview' })
  return userEvent.setup()
}

describe('the overview', () => {
  it('shows real counts from the list endpoint, one request per status and no products downloaded', async () => {
    const seen: string[] = []
    server.use(
      ...brandHandlers({ inReview: 2 }),
      productsHandler({ draft: 3, pending_review: 2, approved: 7, rejected: 1 }, seen),
      submissionsHandler(3),
    )
    await open()
    const products = await screen.findByRole('region', { name: 'Products' })
    expect(await within(products).findByText('13')).toBeTruthy()
    expect(within(products).getByText('Drafts: 3')).toBeTruthy()
    expect(within(products).getByText('In review: 2')).toBeTruthy()
    expect(within(products).getByText('Live: 7')).toBeTruthy()
    expect(within(products).getByText('Needs changes: 1')).toBeTruthy()
    expect(new Set(seen)).toEqual(new Set(['draft:1', 'pending_review:1', 'approved:1', 'rejected:1']))
    // The brand page and products together, from the submissions list.
    expect(await screen.findByText('3 items are waiting for review.')).toBeTruthy()
  })

  it('shows where the brand page stands: a version in review, and what is live', async () => {
    server.use(...brandHandlers({ inReview: 3, publishedAt: '2026-10-01T00:00:00Z' }), productsHandler({}), submissionsHandler())
    await open()
    const brand = await screen.findByRole('region', { name: 'Brand page' })
    expect(await within(brand).findByText('Version 3 in review')).toBeTruthy()
    expect(within(brand).getByText('A version is live on Shazlo.')).toBeTruthy()
  })

  it('shows a plain draft with nothing live as that', async () => {
    server.use(...brandHandlers(), productsHandler({}), submissionsHandler())
    await open()
    const brand = await screen.findByRole('region', { name: 'Brand page' })
    expect(await within(brand).findByText('Draft')).toBeTruthy()
    expect(within(brand).getByText('Nothing is live on Shazlo yet.')).toBeTruthy()
  })

  it('shows an error for the brand card when the published version cannot be read (a 404 is not an error)', async () => {
    server.use(
      http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'draft', published_at: null, in_review_version: null })),
      http.get(`${BASE}/v1/vendor/brand-profile/published`, () => apiErrorResponse(500, 'internal_error', 'boom')),
      productsHandler({}),
      submissionsHandler(),
    )
    await open()
    const brand = await screen.findByRole('region', { name: 'Brand page' })
    expect(await within(brand).findByText("We couldn't load your brand page")).toBeTruthy()
    expect(within(brand).queryByText('Draft')).toBeNull()
  })

  it('says so when nothing is live or waiting', async () => {
    server.use(...brandHandlers(), productsHandler({}), submissionsHandler())
    await open()
    expect(await screen.findByText('Nothing is live on Shazlo yet.')).toBeTruthy()
    expect(await screen.findByText('Nothing is waiting for review.')).toBeTruthy()
    expect(await screen.findByText('0')).toBeTruthy()
  })

  it('lists the latest decisions, with a link to fix a rejected one', async () => {
    server.use(
      ...brandHandlers(),
      productsHandler({}),
      submissionsHandler(1, [
        decision({ status: 'pending', decided_at: null, title: 'Waiting kurta' }),
        decision({ status: 'rejected', id: 'p9', title: 'Dark photos kurta', reason: 'Too dark' }),
        decision({ subject: 'brand_profile', id: 'b1', sku: null, title: null, version: 2 }),
      ]),
    )
    await open()
    const card = await screen.findByRole('region', { name: 'Submissions' })
    expect(await within(card).findByText('1 item is waiting for review.')).toBeTruthy()
    const items = within(within(card).getByRole('list')).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining('Not approvedDark photos kurta'), expect.stringContaining('ApprovedBrand page')])
    expect(within(card).getByRole('link', { name: 'Dark photos kurta' }).getAttribute('href')).toBe('/products/p9')
    expect(within(card).queryByText('Waiting kurta')).toBeNull()
  })

  it('lists the most recent decision first, whenever it was submitted', async () => {
    server.use(
      ...brandHandlers(),
      productsHandler({}),
      submissionsHandler(0, [
        decision({ id: 'p1', title: 'Decided first', submitted_at: '2026-11-12T09:00:00Z', decided_at: '2026-11-13T09:00:00Z' }),
        decision({ id: 'p2', title: 'Decided last', submitted_at: '2026-11-11T09:00:00Z', decided_at: '2026-11-14T09:00:00Z' }),
      ]),
    )
    await open()
    const card = await screen.findByRole('region', { name: 'Submissions' })
    await within(card).findByText('Decided last')
    const items = within(within(card).getByRole('list')).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining('Decided last'), expect.stringContaining('Decided first')])
  })

  it('has a card that links to every section the vendor can open', async () => {
    server.use(...brandHandlers(), productsHandler({}), submissionsHandler())
    await open('owner')
    const hrefs = (await screen.findAllByRole('link', { name: /^(Edit your brand page|Manage products|See submissions|Import a spreadsheet|Manage your team|Your account)$/ })).map((link) => link.getAttribute('href'))
    expect(hrefs.sort()).toEqual(['/account', '/brand', '/import', '/products', '/submissions', '/team'])
  })

  it('does not show staff the Team card', async () => {
    server.use(...brandHandlers(), productsHandler({}), submissionsHandler())
    await open('staff')
    await screen.findByRole('region', { name: 'Products' })
    expect(screen.queryByRole('region', { name: 'Team' })).toBeNull()
  })

  it('shows what is loading while the numbers arrive', async () => {
    server.use(
      http.get(`${BASE}/v1/vendor/brand-profile`, async () => { await new Promise((r) => setTimeout(r, 200)); return HttpResponse.json({ state: 'draft', published_at: null, in_review_version: null }) }),
      http.get(`${BASE}/v1/vendor/brand-profile/published`, () => apiErrorResponse(404, 'no_published_profile')),
      productsHandler({}),
      submissionsHandler(),
    )
    await open()
    expect((await screen.findAllByRole('status')).length).toBeGreaterThan(0)
  })

  it('shows an error with Try again and the request id, and recovers on retry', async () => {
    let fail = true
    server.use(
      ...brandHandlers(),
      http.get(`${BASE}/v1/vendor/products`, ({ request }) => {
        if (fail) return apiErrorResponse(500, 'internal_error', 'boom', { 'X-Request-ID': 'req-abc-123' })
        const status = new URL(request.url).searchParams.get('status')
        return HttpResponse.json({ items: [], total: status === 'approved' ? 4 : 0, limit: 1, offset: 0 })
      }),
    )
    const user = await open()
    const alert = await screen.findAllByText("We couldn't load your products")
    expect(alert.length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/req-abc-123/)).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/boom|internal_error|500/)
    fail = false
    await user.click(screen.getAllByRole('button', { name: 'Try again' })[0]!)
    await waitFor(() => expect(screen.getByText('Live: 4')).toBeTruthy())
  })
})
