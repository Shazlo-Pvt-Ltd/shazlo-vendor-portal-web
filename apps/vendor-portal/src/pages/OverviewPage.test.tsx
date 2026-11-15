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
      http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'pending_review', published_at: null })),
      productsHandler({ draft: 3, pending_review: 2, approved: 7, rejected: 1 }, seen),
    )
    await open()
    const products = await screen.findByRole('region', { name: 'Products' })
    expect(await within(products).findByText('13')).toBeTruthy()
    expect(within(products).getByText('Drafts: 3')).toBeTruthy()
    expect(within(products).getByText('In review: 2')).toBeTruthy()
    expect(within(products).getByText('Live: 7')).toBeTruthy()
    expect(within(products).getByText('Needs changes: 1')).toBeTruthy()
    expect(new Set(seen)).toEqual(new Set(['draft:1', 'pending_review:1', 'approved:1', 'rejected:1']))
    expect(await screen.findByText('2 products are waiting for review.')).toBeTruthy()
  })

  it('shows where the brand page stands', async () => {
    server.use(
      http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'rejected', published_at: '2026-10-01T00:00:00Z' })),
      productsHandler({}),
    )
    await open()
    const brand = await screen.findByRole('region', { name: 'Brand page' })
    expect(await within(brand).findByText('Needs changes')).toBeTruthy()
    expect(within(brand).getByText('A version is live on Shazlo.')).toBeTruthy()
  })

  it('says so when nothing is live or waiting', async () => {
    server.use(http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'draft', published_at: null })), productsHandler({}))
    await open()
    expect(await screen.findByText('Nothing is live on Shazlo yet.')).toBeTruthy()
    expect(await screen.findByText('Nothing is waiting for review.')).toBeTruthy()
    expect(await screen.findByText('0')).toBeTruthy()
  })

  it('has a card that links to every section the vendor can open', async () => {
    server.use(http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'draft', published_at: null })), productsHandler({}))
    await open('owner')
    const hrefs = (await screen.findAllByRole('link', { name: /^(Edit your brand page|Manage products|See submissions|Import a spreadsheet|Manage your team|Your account)$/ })).map((link) => link.getAttribute('href'))
    expect(hrefs.sort()).toEqual(['/account', '/brand', '/import', '/products', '/submissions', '/team'])
  })

  it('does not show staff the Team card', async () => {
    server.use(http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'draft', published_at: null })), productsHandler({}))
    await open('staff')
    await screen.findByRole('region', { name: 'Products' })
    expect(screen.queryByRole('region', { name: 'Team' })).toBeNull()
  })

  it('shows what is loading while the numbers arrive', async () => {
    server.use(
      http.get(`${BASE}/v1/vendor/brand-profile`, async () => { await new Promise((r) => setTimeout(r, 200)); return HttpResponse.json({ state: 'draft', published_at: null }) }),
      productsHandler({}),
    )
    await open()
    expect((await screen.findAllByRole('status')).length).toBeGreaterThan(0)
  })

  it('shows an error with Try again and the request id, and recovers on retry', async () => {
    let fail = true
    server.use(
      http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'draft', published_at: null })),
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
