import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { setViewport } from '../../test/viewport'
import { detail, fullRevision } from '../products/testing'
import { endVisit, resetLastVisit } from './lastVisit'
import type { Submission } from './rules'
import { submission } from './testing'

const server = useApiServer()
const LIST = `${BASE}/v1/vendor/submissions`

/** A fake submissions list. `items` can be changed between requests; every query is recorded. */
function serve(initial: Submission[]) {
  const state = { items: initial, queries: [] as URLSearchParams[] }
  server.use(
    http.get(LIST, ({ request }) => {
      const params = new URL(request.url).searchParams
      state.queries.push(params)
      const status = params.get('status')
      const subject = params.get('subject')
      const matches = state.items.filter((item) => (!status || status === 'all' || item.status === status) && (!subject || item.subject === subject))
      return HttpResponse.json({ items: matches, total: matches.length, limit: 20, offset: 0 })
    }),
    http.get(`${BASE}/v1/vendor/products/:id`, () => apiErrorResponse(404, 'product_not_found')),
  )
  return state
}

async function open(path = '/submissions') {
  setViewport(1280)
  const router = renderRoute(path, { store: makeStore({ refresh: async () => sessionBody() }).store })
  await screen.findByRole('heading', { level: 1, name: 'Submissions' }, { timeout: 15_000 })
  return { router, user: userEvent.setup() }
}

const card = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('li') as HTMLElement

beforeEach(() => resetLastVisit())

describe('the submissions page', () => {
  it('shows each status in words, with submitted and decided dates', async () => {
    serve([
      submission({ id: 'a', title: 'Waiting kurta', status: 'pending', decided_at: null }),
      submission({ id: 'b', title: 'Approved kurta' }),
      submission({ id: 'c', title: 'Rejected kurta', status: 'rejected', reason: 'Too dark' }),
      submission({ id: 'd', title: 'Withdrawn kurta', status: 'withdrawn' }),
    ])
    await open()
    await screen.findByRole('heading', { level: 2, name: 'Waiting kurta' })
    expect(within(card('Waiting kurta')).getByText('In review')).toBeTruthy()
    expect(within(card('Waiting kurta')).getByText('Waiting for a decision')).toBeTruthy()
    expect(within(card('Approved kurta')).getByText('Approved')).toBeTruthy()
    expect(within(card('Rejected kurta')).getByText('Not approved')).toBeTruthy()
    // The chip; "Withdrawn" also introduces the date.
    expect(card('Withdrawn kurta').querySelector('.MuiChip-label')?.textContent).toBe('Withdrawn')
    const times = card('Approved kurta').querySelectorAll('time')
    expect([...times].map((t) => t.getAttribute('datetime'))).toEqual(['2026-11-10T09:30:00Z', '2026-11-11T12:00:00Z'])
    expect(times[0]?.getAttribute('title')).toMatch(/10 Nov 2026/)
  })

  it("shows a rejected brand page's reason as plain text, line breaks kept, with a link to fix it", async () => {
    serve([submission({ subject: 'brand_profile', id: 'b1', sku: null, title: null, status: 'rejected', reason: '<b>Logo</b> is blurry.\n<script>alert(1)</script>' })])
    await open()
    await screen.findByRole('heading', { level: 2, name: 'Brand page' })
    const item = card('Brand page')
    const reason = within(item).getByTestId('review-reason')
    expect(reason.textContent).toBe('<b>Logo</b> is blurry.\n<script>alert(1)</script>')
    expect(item.querySelector('b, script')).toBeNull()
    expect(within(item).getByRole('link', { name: 'Fix and resubmit: Brand page' }).getAttribute('href')).toBe('/brand')
  })

  it('links a rejected product to its own page, and says when the live version is unchanged', async () => {
    serve([submission({ id: 'p5', version: 2, status: 'rejected', reason: 'Wrong price' })])
    server.use(http.get(`${BASE}/v1/vendor/products/p5`, () => HttpResponse.json(detail('p5', { status: 'approved', live: fullRevision({ version: 1 }) }))))
    await open()
    await screen.findByRole('heading', { level: 2, name: 'Indigo kurta' })
    const item = card('Indigo kurta')
    expect(within(item).getByRole('link', { name: 'Fix and resubmit: Indigo kurta' }).getAttribute('href')).toBe('/products/p5')
    expect(await within(item).findByText('The live version (version 1) is unchanged: shoppers still see it.')).toBeTruthy()
  })

  it('does not offer to fix a rejection that a later version replaced', async () => {
    serve([submission({ version: 2, status: 'pending', decided_at: null }), submission({ version: 1, status: 'rejected', reason: 'Too dark' })])
    await open()
    await screen.findAllByRole('heading', { level: 2, name: 'Indigo kurta' })
    expect(screen.getByText('A newer version was submitted after this one.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Fix and resubmit/ })).toBeNull()
  })

  it('filters by status and type through the address', async () => {
    const state = serve([submission(), submission({ subject: 'brand_profile', id: 'b1', title: null, sku: null, status: 'rejected' })])
    const { router, user } = await open()
    await screen.findByRole('heading', { level: 2, name: 'Indigo kurta' })
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Not approved' }))
    await waitFor(() => expect(router.state.location.search).toBe('?status=rejected'))
    expect(await screen.findByText('1 submission matches, newest first.')).toBeTruthy()
    expect(state.queries.at(-1)?.get('status')).toBe('rejected')
    await user.click(screen.getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByRole('option', { name: 'Product' }))
    expect(await screen.findByText('No submissions match')).toBeTruthy()
    expect(state.queries.at(-1)?.get('subject')).toBe('product')
  })

  it('refreshes when the window regains focus and announces a status that changed', async () => {
    const state = serve([submission({ status: 'pending', decided_at: null })])
    await open()
    await screen.findByText('Waiting for a decision')
    state.items = [submission({ status: 'approved' })]
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    expect(await within(card('Indigo kurta')).findByText('Approved')).toBeTruthy()
    const live = screen.getAllByRole('status').find((element) => element.getAttribute('aria-live') === 'polite' && element.textContent?.startsWith('Status updated'))
    expect(live?.textContent).toBe('Status updated. Indigo kurta, version 1: approved.')
    act(() => focusManager.setFocused(undefined))
  })

  it('asks again every minute while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const state = serve([submission()])
      await open()
      await screen.findByRole('heading', { level: 2, name: 'Indigo kurta' })
      const before = state.queries.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000)
      })
      expect(state.queries.length).toBe(before)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      await waitFor(() => expect(state.queries.length).toBe(before + 1))
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks decisions made since the last visit, and none on the first', async () => {
    serve([
      submission({ id: 'old', title: 'Old kurta', decided_at: '2026-11-11T12:00:00Z' }),
      submission({ id: 'new', title: 'New kurta', decided_at: '2026-11-13T12:00:00Z' }),
    ])
    endVisit(Date.parse('2026-11-12T00:00:00Z'))
    await open()
    await screen.findByRole('heading', { level: 2, name: 'New kurta' })
    expect(within(card('New kurta')).getByText('New since your last visit')).toBeTruthy()
    expect(within(card('Old kurta')).queryByText('New since your last visit')).toBeNull()
  })

  it('marks nothing as new on the first visit', async () => {
    serve([submission({ decided_at: '2026-11-13T12:00:00Z' })])
    await open()
    await screen.findByRole('heading', { level: 2, name: 'Indigo kurta' })
    expect(screen.queryByText('New since your last visit')).toBeNull()
  })

  it('offers the first page when the address points past the last one', async () => {
    const state = serve([submission()])
    server.use(
      http.get(LIST, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'))
        return HttpResponse.json({ items: offset === 0 ? state.items : [], total: state.items.length, limit: 20, offset })
      }),
    )
    const { router, user } = await open('/submissions?page=4')
    expect(await screen.findByRole('heading', { name: 'Nothing on this page' })).toBeTruthy()
    expect(screen.queryByText('Nothing submitted yet')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Go to the first page' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByRole('heading', { level: 2, name: 'Indigo kurta' })).toBeTruthy()
  })

  it('tells a vendor who has submitted nothing what to do next', async () => {
    serve([])
    await open()
    expect(await screen.findByRole('heading', { name: 'Nothing submitted yet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Edit your brand page' }).getAttribute('href')).toBe('/brand')
    expect(screen.getByRole('link', { name: 'Add a product' }).getAttribute('href')).toBe('/products/new')
  })

  it('shows an error with a way to try again', async () => {
    server.use(http.get(LIST, () => apiErrorResponse(500, 'internal_error')))
    await open()
    expect(await screen.findByText("We couldn't load your submissions")).toBeTruthy()
  })
})
